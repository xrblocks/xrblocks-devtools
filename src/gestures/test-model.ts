import {open} from 'node:fs/promises';
import path from 'node:path';
import {Vector3} from 'three';
import {resolveHandJoints} from '../hands/kinematics.js';
import {HAND_POSES} from '../hands/poses.js';
import {handFeatures} from './features.js';
import {predictFeatures} from './classifier.js';
import {decodeTFLite} from './tflite.js';
import {testGestureModelSchema} from './schema.js';
import type {TestGestureModelRequest} from './schema.js';

export async function testGestureModel(
  input: TestGestureModelRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const options = testGestureModelSchema.parse(input);
  const ids = options.poses.map((pose, index) => pose.id ?? `pose-${index}`);
  if (new Set(ids).size !== ids.length)
    throw new Error('Pose IDs must be unique.');
  const modelPath = path.resolve(options.model);
  const file = await open(modelPath, 'r');
  let bytes: Uint8Array;
  try {
    const size = (await file.stat()).size;
    if (size < 8 || size > 1024 * 1024)
      throw new Error('Gesture model must be between 8 bytes and 1 MB.');
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  const {manifest, classifier} = decodeTFLite(bytes);
  for (const pose of options.poses) {
    if (
      pose.expected !== undefined &&
      pose.expected !== null &&
      pose.expected !== 'other' &&
      !manifest.labels.includes(pose.expected)
    )
      throw new Error(`Unknown expected gesture: ${pose.expected}`);
  }
  const results = [];
  for (const [index, pose] of options.poses.entries()) {
    signal?.throwIfAborted();
    for (const hand of pose.hand === 'both'
      ? (['left', 'right'] as const)
      : [pose.hand]) {
      const rotations = {...HAND_POSES[pose.pose], ...pose.rotations};
      const points = resolveHandJoints(hand, rotations).map(({t}) =>
        new Vector3().fromArray(t)
      );
      const features = handFeatures(points, hand);
      if (!features) throw new Error(`Degenerate hand in ${ids[index]}.`);
      const scores = predictFeatures(classifier, features);
      const ranked = manifest.labels
        .map((label, i) => ({label, score: scores[i]}))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      const prediction =
        best.label !== 'other' && best.score >= manifest.threshold
          ? best.label
          : null;
      const expected = pose.expected === 'other' ? null : pose.expected;
      results.push({
        id: ids[index],
        hand,
        prediction,
        bestMatch: best.label,
        score: best.score,
        margin: best.score - ranked[1].score,
        scores: Object.fromEntries(
          ranked.map(({label, score}) => [label, score])
        ),
        ...(expected === undefined
          ? {}
          : {expected, correct: prediction === expected}),
      });
    }
    if (index % 50 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const evaluated = results.filter((result) => 'correct' in result);
  return {
    model: modelPath,
    threshold: manifest.threshold,
    labels: manifest.labels,
    results,
    ...(evaluated.length
      ? {
          evaluation: {
            total: evaluated.length,
            correct: evaluated.filter((result) => result.correct).length,
            accuracy:
              evaluated.filter((result) => result.correct).length /
              evaluated.length,
          },
        }
      : {}),
  };
}
