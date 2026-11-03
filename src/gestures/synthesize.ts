import {Vector3} from 'three';
import {constrainHandAngles, resolveHandJoints} from '../hands/kinematics.js';
import {HAND_POSES} from '../hands/poses.js';
import {ANGLE_LIMITS_DEGREES} from '../hands/skeleton.js';
import type {HandPoseJointName, HandPoseRotations} from '../hands/types.js';
import {handFeatures} from './features.js';
import type {ResolvedTrainingConfig} from './schema.js';

export type GestureSample = {target: number; features: Float32Array};

export function randomGenerator(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export async function synthesize(
  config: ResolvedTrainingConfig,
  signal?: AbortSignal
) {
  const random = randomGenerator(config.seed);
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const training: GestureSample[] = [];
  const validation: GestureSample[] = [];
  const warnings: string[] = [];
  const labels = Object.keys(config.gestures);
  for (const [target, label] of labels.entries()) {
    for (const [configuration, pose] of config.gestures[label].entries()) {
      const original = {...HAND_POSES[pose.pose], ...pose.rotations};
      const base = constrainHandAngles(original);
      if (
        Object.entries(base).some(([name, angles]) =>
          angles.some(
            (v, axis) =>
              Math.abs(v - original[name as HandPoseJointName]![axis]) > 1e-8
          )
        )
      ) {
        warnings.push(
          `Applied anatomical limits to ${label}[${configuration}].`
        );
      }
      for (const hand of ['left', 'right'] as const) {
        for (let sample = 0; sample < config.samplesPerPose; sample++) {
          signal?.throwIfAborted();
          const rotations: HandPoseRotations = {...base};
          const curl = new Map<string, number>();
          for (const [name, limits] of Object.entries(ANGLE_LIMITS_DEGREES)) {
            const finger = name.split('-')[0];
            if (!curl.has(finger))
              curl.set(finger, gaussian() * config.angleStddevRadians * 0.5);
            rotations[name as HandPoseJointName] = limits.map(
              ([minDegrees, maxDegrees], axis) => {
                const value = base[name as HandPoseJointName]?.[axis] ?? 0;
                if (sample === 0) return value;
                const min = (minDegrees * Math.PI) / 180;
                const max = (maxDegrees * Math.PI) / 180;
                if (min === max) return min;
                for (let attempt = 0; attempt < 32; attempt++) {
                  const noise =
                    gaussian() *
                    config.angleStddevRadians *
                    [0.5, 0.15, 0.1][axis];
                  const angle =
                    value + noise + (axis === 0 ? curl.get(finger)! : 0);
                  if (angle >= min && angle <= max) return angle;
                }
                return value;
              }
            ) as [number, number, number];
          }
          const points = resolveHandJoints(hand, rotations).map(({t}) => {
            const point = new Vector3().fromArray(t);
            if (sample > 0) {
              point.x += gaussian() * config.keypointStddevMeters;
              point.y += gaussian() * config.keypointStddevMeters;
              point.z += gaussian() * config.keypointStddevMeters;
            }
            return point;
          });
          const features = handFeatures(points, hand, config.features);
          if (!features)
            throw new Error(
              `Degenerate hand in ${label}[${configuration}]. Reduce noise or fix the base pose.`
            );
          (sample > 0 && sample % 5 === 1 ? validation : training).push({
            target,
            features,
          });
          if (sample % 100 === 0)
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }
  }
  return {labels, training, validation, warnings};
}
