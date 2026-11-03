import {Vector3} from 'three';
import {constrainHandAngles, resolveHandJoints} from '../hands/kinematics.js';
import {HAND_POSES} from '../hands/poses.js';
import {ANGLE_LIMITS_DEGREES} from '../hands/skeleton.js';
import type {
  HandPoseJointName,
  HandPoseRotations,
  NamedHandPose,
  PhysicalHand,
} from '../hands/types.js';

export function randomGenerator(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function augmentPose(
  pose: {
    pose: NamedHandPose;
    rotations: HandPoseRotations;
    hand?: PhysicalHand | 'both';
  },
  options: {
    samplesPerPose: number;
    angleStddevRadians: number;
    keypointStddevMeters: number;
    constrain: boolean;
  },
  random: () => number
) {
  const original = {...HAND_POSES[pose.pose], ...pose.rotations};
  const base = options.constrain ? constrainHandAngles(original) : original;
  const adjusted = Object.entries(base).some(([name, angles]) =>
    angles.some(
      (v, axis) =>
        Math.abs(v - original[name as HandPoseJointName]![axis]) > 1e-8
    )
  );
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  function* samples() {
    for (const hand of !pose.hand || pose.hand === 'both'
      ? (['left', 'right'] as const)
      : [pose.hand]) {
      for (let sample = 0; sample < options.samplesPerPose; sample++) {
        const rotations: HandPoseRotations = {...base};
        const curl = new Map<string, number>();
        for (const [name, limits] of Object.entries(ANGLE_LIMITS_DEGREES)) {
          const finger = name.split('-')[0];
          if (!curl.has(finger))
            curl.set(finger, gaussian() * options.angleStddevRadians * 0.5);
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
                  options.angleStddevRadians *
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
            point.x += gaussian() * options.keypointStddevMeters;
            point.y += gaussian() * options.keypointStddevMeters;
            point.z += gaussian() * options.keypointStddevMeters;
          }
          return point;
        });
        yield {hand, sample, rotations, points};
      }
    }
  }
  return {adjusted, samples: samples()};
}
