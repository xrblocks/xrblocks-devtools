import * as z from 'zod/v4';
import {HAND_POSE_JOINT_NAMES, NAMED_HAND_POSES} from '../session/types.js';

export const text = z.string().trim().min(1);
export const jsonObject = z.record(z.string(), z.json());
export const vector = z.tuple([z.number(), z.number(), z.number()]);
export const hand = z.enum(['left', 'right']);
export const pose = z.enum(NAMED_HAND_POSES);
export const rotations = z.partialRecord(z.enum(HAND_POSE_JOINT_NAMES), vector);
export const target = z
  .union([text, vector, z.strictObject({tag: text, id: text.optional()})])
  .describe(
    'Exact scene name, world position [x,y,z] in meters, or a devtools tag.'
  );
export const angularOptions = z.strictObject({
  speedDegreesPerSecond: z.number().min(5).max(3600).optional(),
});
export const anchor = z.enum(['index-tip', 'palm-center']);
export const linearOptions = z.strictObject({
  speedMetersPerSecond: z.number().min(0.05).max(20).optional(),
  anchor: anchor.optional(),
});
export const motion = z.strictObject({
  rightMeters: z.number().optional(),
  upMeters: z.number().optional(),
  forwardMeters: z.number().optional(),
  speedMetersPerSecond: z.number().min(0.05).max(20).optional(),
});
export const rotation = z.strictObject({
  pitchDegrees: z.number().optional(),
  yawDegrees: z.number().optional(),
  rollDegrees: z.number().optional(),
  speedDegreesPerSecond: z.number().min(5).max(3600).optional(),
});
export const sceneOptions = z.strictObject({
  semanticTree: z.boolean().optional(),
  visibleObjects: z.boolean().optional(),
  setOfMark: z.boolean().optional(),
});
export const devtoolsOptions = z.strictObject({
  locations: z.boolean().optional(),
  tags: z.boolean().optional(),
  state: z.boolean().optional(),
  spatial: z.boolean().optional(),
  view: z.boolean().optional(),
});

const handControl = z.strictObject({
  move: vector
    .optional()
    .describe('Camera-space meters; negative Z is forward.'),
  rotate: vector.optional().describe('[pitch,yaw,roll] in degrees.'),
  selectStart: z.boolean().optional(),
  selectEnd: z.boolean().optional(),
  pose: pose.optional(),
  rotations: rotations
    .optional()
    .describe(
      'Sparse joint rotations in radians; cannot combine with pose or selection.'
    ),
  visible: z.boolean().optional(),
});
export const control = z.strictObject({
  locomotion: z
    .strictObject({
      move: vector
        .optional()
        .describe('Camera-space meters; negative Z is forward.'),
      rotate: vector.optional().describe('[pitch,yaw,roll] in degrees.'),
    })
    .optional(),
  leftHand: handControl.optional(),
  rightHand: handControl.optional(),
});

const objectProperties = {
  position: vector.optional(),
  quaternion: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .optional(),
  scale: vector.optional(),
  visible: z.boolean().optional(),
  detectObject: z.boolean().optional(),
  physics: z.union([z.literal(false), z.enum(['fixed', 'dynamic'])]).optional(),
  data: z.json().optional(),
};
export const simulatorObject = z
  .strictObject({
    ...objectProperties,
    id: text.optional(),
    tag: text.optional(),
    state: jsonObject.optional(),
    label: z.string().optional(),
    assetPath: text.optional(),
    file: text.optional(),
    object: jsonObject
      .optional()
      .describe('Serialized Three.js Object3D.toJSON() output.'),
  })
  .refine(
    (value) =>
      [value.assetPath, value.file, value.object].filter((v) => v !== undefined)
        .length === 1,
    'Specify exactly one of assetPath, file, or object.'
  );
export const objectUpdate = z.strictObject({
  ...objectProperties,
  id: text,
  label: z.string().nullable().optional(),
});

const viewport = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const recording = z.discriminatedUnion('mode', [
  z.strictObject({mode: z.literal('checkpoints'), out: text}),
  z.strictObject({
    mode: z.literal('video'),
    out: text,
    size: viewport.optional(),
    scope: z.enum(['actions', 'scene', 'full']).optional(),
    keepRaw: z.boolean().optional(),
    paddingMs: z.number().nonnegative().optional(),
  }),
]);
export const openSession = z
  .strictObject({
    label: text.optional(),
    appDir: text.optional(),
    url: z.url().optional(),
    xrblocksRoot: text.optional(),
    entry: text.optional(),
    headless: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    viewport: viewport.optional(),
    realTime: z.boolean().optional(),
    monitorAudio: z.boolean().optional(),
    simulatorReachLimit: z.boolean().optional(),
    simulatorNavMesh: z.boolean().optional(),
    simulatorObjects: z.array(simulatorObject).optional(),
    embodiedControlImport: text.optional(),
    recording: recording.optional(),
  })
  .refine(
    (value) => Boolean(value.appDir) !== Boolean(value.url),
    'Specify exactly one of appDir or url.'
  )
  .refine(
    (value) => !value.url || (!value.xrblocksRoot && !value.entry),
    'xrblocksRoot and entry require appDir.'
  );

const previewInput = z.union([
  z.strictObject({path: text}),
  z.strictObject({source: text}),
]);
const views = z.enum(['inspection-4', 'turntable-4', 'front']);
export const preview = z.strictObject({
  request: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('ui'),
      input: previewInput,
      assetsDir: text.optional(),
      xrblocksRoot: text.optional(),
    }),
    z.strictObject({
      kind: z.literal('model'),
      input: previewInput,
      assetsDir: text.optional(),
      views: views.optional(),
    }),
    z.strictObject({
      kind: z.literal('hand'),
      pose: pose.optional(),
      rotations: rotations.optional(),
      hand: z.enum(['left', 'right', 'both']).optional(),
      views: views.optional(),
      xrblocksRoot: text.optional(),
    }),
  ]),
  out: text.optional(),
  size: z
    .string()
    .regex(/^[1-9]\d*x[1-9]\d*$/)
    .optional(),
  background: text.optional(),
});

export function materializeObjects(values: z.infer<typeof simulatorObject>[]) {
  return values.map(({object, ...rest}) => ({
    ...rest,
    ...(object ? {object: {toJSON: () => object}} : {}),
  }));
}
