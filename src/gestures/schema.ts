import * as z from 'zod/v4';
import {
  HAND_JOINT_NAMES,
  HAND_POSE_JOINT_NAMES,
  NAMED_HAND_POSES,
} from '../hands/types.js';

const label = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) => value === value.trim(),
    'Labels must not have surrounding whitespace.'
  )
  .refine(
    (value) => !['__proto__', 'constructor', 'prototype'].includes(value),
    'Reserved label.'
  );
const angles = z.tuple([z.number(), z.number(), z.number()]);
const features = z.enum(['palm-local-xyz-v1', 'relative-bone-angles-v1']);
export const gesturePoseSchema = z.strictObject({
  pose: z.enum(NAMED_HAND_POSES).default('neutral'),
  rotations: z.partialRecord(z.enum(HAND_POSE_JOINT_NAMES), angles).default({}),
});

const interpolation = z.strictObject({
  t: z.number().min(0).max(1),
  fromLabel: label.nullable(),
  toLabel: label.nullable(),
  suggestedLabel: label.nullable(),
  labelSource: z.enum(['endpoint', 'shared-endpoints', 'unlabeled']),
});

export const gestureTestPoseSchema = gesturePoseSchema.extend({
  id: z.string().trim().min(1).max(100).optional(),
  hand: z.enum(['left', 'right', 'both']).default('both'),
  expected: label.nullable().optional(),
  interpolation: interpolation.optional(),
});

export const sampleGesturesSchema = z.strictObject({
  from: gesturePoseSchema.extend({label: label.optional()}),
  to: gesturePoseSchema.extend({label: label.optional()}),
  steps: z.number().int().min(2).max(101).default(9),
});

export const testGestureModelSchema = z.strictObject({
  model: z.string().trim().min(1),
  poses: z.array(gestureTestPoseSchema).min(1).max(1000),
});

export type SampleGesturesRequest = z.input<typeof sampleGesturesSchema>;
export type GestureTestPose = z.input<typeof gestureTestPoseSchema>;
export type TestGestureModelRequest = z.input<typeof testGestureModelSchema>;
export const gestureTrainingSchema = z
  .strictObject({
    features: features.default('palm-local-xyz-v1'),
    seed: z.number().int().min(0).max(0xffffffff).default(42),
    samplesPerPose: z.number().int().min(2).max(2000).default(250),
    angleStddevRadians: z.number().min(0).max(0.5).default(0.08),
    keypointStddevMeters: z.number().min(0).max(0.01).default(0.001),
    threshold: z.number().min(0).max(1).default(0.6),
    gestures: z.record(label, z.array(gesturePoseSchema).min(1).max(32)),
  })
  .superRefine((config, context) => {
    const entries = Object.entries(config.gestures);
    if (entries.length < 2 || entries.length > 16) {
      context.addIssue({code: 'custom', message: 'Use 2–16 gesture labels.'});
    }
    const total = entries.reduce(
      (sum, [, poses]) => sum + poses.length * config.samplesPerPose * 2,
      0
    );
    if (total > 20000 || total * entries.length > 100000) {
      context.addIssue({
        code: 'custom',
        message:
          'Too many samples. Reduce samplesPerPose or the number of configurations.',
      });
    }
  });

export type GestureTrainingConfig = z.input<typeof gestureTrainingSchema>;
export type ResolvedTrainingConfig = z.output<typeof gestureTrainingSchema>;

export const gestureManifestSchema = z.strictObject({
  format: z.literal('xrblocks-hand-gestures'),
  version: z.literal(1),
  features,
  joints: z
    .array(z.string())
    .refine(
      (names) => JSON.stringify(names) === JSON.stringify(HAND_JOINT_NAMES),
      'Unsupported joint order.'
    ),
  labels: z
    .array(label)
    .min(2)
    .max(16)
    .refine((labels) => new Set(labels).size === labels.length),
  threshold: z.number().min(0).max(1),
});

export type GestureManifest = z.infer<typeof gestureManifestSchema>;
