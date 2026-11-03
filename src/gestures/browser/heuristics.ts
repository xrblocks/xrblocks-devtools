import * as xb from 'xrblocks';
import {Vector3} from 'three';
import {detectors} from 'virtual:input';
import {HAND_JOINT_NAMES} from '../../hands/types.js';
import type {PhysicalHand} from '../../hands/types.js';
import {detectorLabelsSchema} from '../schema.js';

export type HandPoseCase = {
  id: string;
  hand: PhysicalHand;
  sample: number;
  points: number[][];
  expected?: string | string[] | null;
};

function contextFor(item: HandPoseCase): xb.HandContext {
  const joints = new Map(
    HAND_JOINT_NAMES.map((name, index) => [
      name,
      new Vector3().fromArray(item.points[index]),
    ])
  );
  return {
    handedness: item.hand === 'left' ? xb.Handedness.LEFT : xb.Handedness.RIGHT,
    handLabel: item.hand,
    joints,
    getJoint: (name) => joints.get(name),
  };
}

function measure(context: xb.HandContext) {
  const palm = xb.getPalmPose(context);
  if (!palm || palm.width < 1e-6) throw new Error('Degenerate palm.');
  const digits = ['thumb', ...xb.FINGER_ORDER] as const;
  const distances = digits.flatMap((a, index) =>
    digits.slice(index + 1).map((b) => {
      const meters = xb.getFingertipDistance(context, a, b)!;
      return {from: a, to: b, meters, palmWidths: meters / palm.width};
    })
  );
  return {
    palm: {
      widthMeters: palm.width,
      center: palm.center.toArray(),
      normal: palm.normal.toArray(),
      right: palm.right.toArray(),
      up: palm.up.toArray(),
    },
    fingers: Object.fromEntries(
      xb.FINGER_ORDER.map((finger) => [
        finger,
        {
          bendCosines: xb.getFingerBendAngles(context, finger),
          curl: xb.getFingerCurl(context, finger),
          straightness: xb.getFingerStraightness(context, finger),
          direction: xb.getFingerDirection(context, finger)?.toArray() ?? null,
          palmAlignment: xb.getFingerPalmAlignment(context, finger),
          tipToPalmMeters: xb.getFingertipPalmDistance(context, finger),
          tipToPalmNormalized:
            xb.getFingertipPalmDistance(context, finger)! / palm.width,
        },
      ])
    ),
    thumb: {
      bendCosines: xb.getThumbBendAngles(context),
      curl: xb.getThumbCurl(context),
      straightness: xb.getThumbStraightness(context),
      direction: xb.getThumbDirection(context)?.toArray() ?? null,
      verticalDirection: xb.getThumbVerticalDirection(context),
      opposition: Object.fromEntries(
        xb.FINGER_ORDER.map((finger) => [
          finger,
          xb.getThumbOpposition(context, finger),
        ])
      ),
    },
    adjacentSpreads: xb.getAdjacentFingerSpreads(context),
    fingertipDistances: distances,
  };
}

export function inspect(cases: HandPoseCase[]) {
  return {
    results: cases.map((item) => ({
      id: item.id,
      hand: item.hand,
      metrics: measure(contextFor(item)),
    })),
  };
}

export function test(options: {
  cases: HandPoseCase[];
  minimumConfidence: number;
  configurations: Record<string, xb.GestureConfiguration>;
}) {
  if (!detectors || typeof detectors !== 'object' || Array.isArray(detectors))
    throw new Error('Module must export a detectors object.');
  const labels = detectorLabelsSchema.parse(Object.keys(detectors));
  for (const label of labels) {
    if (typeof detectors[label] !== 'function')
      throw new Error(`Detector ${label} must be a function.`);
  }
  for (const label of Object.keys(options.configurations)) {
    if (!labels.includes(label))
      throw new Error(`Unknown configured detector: ${label}`);
  }
  let diagnosticBytes = 0;
  const encoder = new TextEncoder();
  const results = options.cases.map((item) => {
    const expected =
      item.expected === undefined
        ? undefined
        : item.expected === null || item.expected === 'other'
          ? []
          : Array.isArray(item.expected)
            ? item.expected
            : [item.expected];
    if (expected?.some((label) => !labels.includes(label)))
      throw new Error(`Unknown expected detector in ${item.id}.`);
    if (expected && new Set(expected).size !== expected.length)
      throw new Error(`Duplicate expected detectors in ${item.id}.`);
    const context = contextFor(item);
    const scores: Record<
      string,
      {confidence: number; data?: Record<string, unknown>} | null
    > = {};
    for (const label of labels) {
      const config = options.configurations[label] ?? {enabled: true};
      if (!config.enabled) continue;
      try {
        const output = detectors[label](context, config);
        if (output === undefined) {
          scores[label] = null;
          continue;
        }
        if (
          !output ||
          typeof output !== 'object' ||
          !Number.isFinite(output.confidence) ||
          output.confidence < 0 ||
          output.confidence > 1
        )
          throw new Error(
            'Return undefined or {confidence: number between 0 and 1, data?: object}.'
          );
        const serialized = JSON.stringify(
          output.data,
          (_key, value: unknown) => {
            if (typeof value === 'number' && !Number.isFinite(value))
              throw new Error('Diagnostic numbers must be finite.');
            if (
              typeof value === 'function' ||
              typeof value === 'symbol' ||
              typeof value === 'bigint'
            )
              throw new Error('Diagnostics must be JSON data.');
            return value;
          }
        );
        const data: unknown =
          serialized === undefined ? undefined : JSON.parse(serialized);
        const size =
          serialized === undefined ? 0 : encoder.encode(serialized).length;
        if (
          output.data !== undefined &&
          (size > 65536 ||
            !data ||
            typeof data !== 'object' ||
            Array.isArray(data))
        )
          throw new Error('Diagnostic data must be an object under 64 KB.');
        diagnosticBytes += size;
        if (diagnosticBytes > 8 * 1024 * 1024)
          throw new Error(
            'Batch diagnostics exceed 8 MB. Reduce the batch or diagnostic data.'
          );
        scores[label] = {
          confidence: output.confidence,
          ...(data !== undefined
            ? {data: data as Record<string, unknown>}
            : {}),
        };
      } catch (error) {
        throw new Error(
          `${label} failed at ${item.id}/${item.hand}/sample-${item.sample}: ${error instanceof Error ? error.message : String(error)}`,
          {cause: error}
        );
      }
    }
    const accepted = labels.filter(
      (label) =>
        scores[label] && scores[label]!.confidence >= options.minimumConfidence
    );
    const falsePositives =
      expected === undefined
        ? undefined
        : accepted.filter((label) => !expected.includes(label));
    const missed = expected?.filter((label) => !accepted.includes(label));
    return {
      id: item.id,
      hand: item.hand,
      sample: item.sample,
      accepted,
      scores,
      overlap: accepted.length > 1,
      ...(expected === undefined
        ? {}
        : {
            expected,
            falsePositives: falsePositives!,
            missed: missed!,
            correct: !falsePositives!.length && !missed!.length,
          }),
    };
  });
  const evaluated = results.filter((result) => result.correct !== undefined);
  return {
    labels,
    minimumConfidence: options.minimumConfidence,
    results,
    overlaps: results.filter((result) => result.overlap).length,
    ...(evaluated.length
      ? {
          evaluation: {
            total: evaluated.length,
            correct: evaluated.filter((result) => result.correct).length,
            accuracy:
              evaluated.filter((result) => result.correct).length /
              evaluated.length,
            falsePositives: evaluated.reduce(
              (sum, result) => sum + result.falsePositives!.length,
              0
            ),
            misses: evaluated.reduce(
              (sum, result) => sum + result.missed!.length,
              0
            ),
          },
        }
      : {}),
  };
}
