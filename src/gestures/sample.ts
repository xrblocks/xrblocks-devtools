import {constrainHandAngles} from '../hands/kinematics.js';
import {HAND_POSES} from '../hands/poses.js';
import {HAND_POSE_JOINT_NAMES} from '../hands/types.js';
import type {HandPoseRotations} from '../hands/types.js';
import {sampleGesturesSchema} from './schema.js';
import type {SampleGesturesRequest} from './schema.js';

export function sampleGestures(input: SampleGesturesRequest) {
  const {from, to, steps} = sampleGesturesSchema.parse(input);
  const endpoints = [from, to].map(({pose, rotations}) => ({
    ...HAND_POSES[pose],
    ...rotations,
  }));
  const constrained = endpoints.map(constrainHandAngles);
  const changed = endpoints.map((original, index) =>
    HAND_POSE_JOINT_NAMES.some((name) =>
      (original[name] ?? [0, 0, 0]).some(
        (angle, axis) =>
          Math.abs(angle - constrained[index][name]![axis]) > 1e-8
      )
    )
  );
  const warnings = changed.flatMap((adjusted, index) =>
    adjusted
      ? [
          `Applied anatomical limits to ${index === 0 ? 'from' : 'to'}; review its label.`,
        ]
      : []
  );
  const poses = Array.from({length: steps}, (_, index) => {
    const t = index / (steps - 1);
    const rotations = Object.fromEntries(
      HAND_POSE_JOINT_NAMES.map((name) => [
        name,
        [0, 1, 2].map(
          (axis) =>
            constrained[0][name]![axis] +
            t * (constrained[1][name]![axis] - constrained[0][name]![axis])
        ),
      ])
    ) as HandPoseRotations;
    const endpoint = index === 0 ? from : index === steps - 1 ? to : undefined;
    const shared =
      from.label !== undefined &&
      from.label === to.label &&
      !changed.some(Boolean);
    const suggestedLabel =
      endpoint && !changed[index === 0 ? 0 : 1]
        ? (endpoint.label ?? null)
        : shared
          ? from.label!
          : null;
    return {
      id: `interpolation-${index}`,
      pose: 'neutral' as const,
      rotations,
      hand: 'both' as const,
      interpolation: {
        t,
        fromLabel: from.label ?? null,
        toLabel: to.label ?? null,
        suggestedLabel,
        labelSource:
          suggestedLabel === null
            ? ('unlabeled' as const)
            : endpoint
              ? ('endpoint' as const)
              : ('shared-endpoints' as const),
      },
    };
  });
  return {poses, warnings};
}
