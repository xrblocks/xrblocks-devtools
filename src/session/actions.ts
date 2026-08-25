import type {XRBlocksSession} from './session.js';
import type {JsonObject} from '../types.js';
import {
  NAMED_HAND_POSES,
  type NamedHandPose,
  type PhysicalHand,
} from './types.js';
import {
  ANGULAR_SPEED,
  boundedSpeed,
  HAND_MOVE_SPEED,
  type SpeedConfig,
  VIEWER_MOVE_SPEED,
} from './motion.js';

type AgentActionDefinition = {
  name: string;
  description: string;
  parameters: JsonObject;
  prompt?: string;
  execute(
    session: XRBlocksSession,
    args: JsonObject
  ): unknown | Promise<unknown>;
};

export type AgentToolProfile = 'primitive' | 'targeted';

export class AgentActionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentActionError';
  }
}

const AGENT_WAIT_MIN_MS = 50;
const AGENT_WAIT_MAX_MS = 2_000;

const AGENT_TOOL_PROFILES = {
  primitive: [
    'say',
    'move',
    'rotate',
    'move_hand',
    'rotate_hand',
    'gesture',
    'start_select',
    'end_select',
    'wait',
  ],
  targeted: [
    'say',
    'move',
    'rotate',
    'move_hand',
    'rotate_hand',
    'gesture',
    'start_select',
    'end_select',
    'wait',
    'look_at_target',
    'point_to_target',
    'reach_to_target',
    'click',
  ],
} as const satisfies Record<AgentToolProfile, readonly string[]>;

const SchemaType = {
  array: 'array',
  integer: 'integer',
  number: 'number',
  object: 'object',
  string: 'string',
} as const;

const AGENT_ACTIONS: readonly AgentActionDefinition[] = Object.freeze([
  {
    name: 'say',
    description:
      'Speak English text into the app through its synthetic microphone.',
    parameters: {
      type: SchemaType.object,
      properties: {text: {type: SchemaType.string}},
      required: ['text'],
    },
    prompt:
      'say speaks text through the app microphone and waits until delivery completes. Use it for voice-controlled app interactions.',
    execute: (session, args) =>
      session.injectAudio({text: requireString(args.text, 'text')}),
  },
  {
    name: 'move',
    description: 'Move the user relative to the current view direction.',
    parameters: linearMotionSchema(VIEWER_MOVE_SPEED, false),
    execute: (session, args) => session.move(linearMotionArgs(args)),
  },
  {
    name: 'rotate',
    description:
      'Rotate the user by relative YXZ Euler angles. Positive pitch is up, yaw is left, and roll is counterclockwise.',
    parameters: rotationSchema(false),
    execute: (session, args) => session.rotate(rotationArgs(args)),
  },
  {
    name: 'move_hand',
    description:
      'Move one hand relative to the current view direction without rotating it. While selection is held, this can provide movement for a direct or ray-based drag.',
    parameters: linearMotionSchema(HAND_MOVE_SPEED, true),
    execute: (session, args) =>
      session.moveHand(handArg(args), linearMotionArgs(args)),
  },
  {
    name: 'rotate_hand',
    description:
      'Rotate one hand and its pointing ray by relative YXZ Euler angles. Positive pitch is up, yaw is left, and roll is counterclockwise. While selection is held, this can provide angular movement for a ray-based drag.',
    parameters: rotationSchema(true),
    execute: (session, args) =>
      session.rotateHand(handArg(args), rotationArgs(args)),
  },
  {
    name: 'gesture',
    description: 'Apply a named pose to the selected hand.',
    parameters: {
      type: SchemaType.object,
      properties: {
        hand: {type: SchemaType.string, enum: ['left', 'right']},
        pose: {type: SchemaType.string, enum: [...NAMED_HAND_POSES]},
      },
      required: ['hand', 'pose'],
    },
    execute: (session, args) =>
      session.gesture(requiredHandArg(args), poseArg(args.pose)),
  },
  {
    name: 'start_select',
    description:
      'Begin holding a WebXR select gesture with the left or right hand; no-op if already selecting.',
    parameters: handToolSchema(),
    execute: (session, args) => session.startSelect(handArg(args)),
  },
  {
    name: 'end_select',
    description:
      'Release a held WebXR select gesture with the left or right hand.',
    parameters: handToolSchema(),
    execute: (session, args) => session.endSelect(handArg(args)),
  },
  {
    name: 'wait',
    description: `Wait for the app to advance for ${AGENT_WAIT_MIN_MS} to ${AGENT_WAIT_MAX_MS} milliseconds.`,
    parameters: {
      type: SchemaType.object,
      properties: {
        duration_ms: {
          type: SchemaType.integer,
          minimum: AGENT_WAIT_MIN_MS,
          maximum: AGENT_WAIT_MAX_MS,
        },
      },
      required: ['duration_ms'],
    },
    prompt:
      'wait advances the app without moving the user. Use it only when the app needs time to respond.',
    execute: (session, args) =>
      session.wait(boundedWaitDuration(args.duration_ms)),
  },
  {
    name: 'look_at_target',
    description:
      'Rotate the camera to look at a live context ID, unique scene name, Devtools tag, or world position.',
    parameters: targetToolSchema(false, ANGULAR_SPEED, true),
    prompt: `look_at_target smoothly rotates the camera toward a context ID, named target, or tagged target at ${ANGULAR_SPEED.default} degrees per second by default.`,
    execute: (session, args) =>
      session.lookAtTarget(requireTarget(args), angularSpeedOptions(args)),
  },
  {
    name: 'point_to_target',
    description:
      'Aim the selected hand ray at a live context ID, unique scene name, Devtools tag, or world position without moving the hand. Changing the aim while selection is held can provide ray-drag movement.',
    parameters: targetToolSchema(true, ANGULAR_SPEED, true),
    prompt: `point_to_target smoothly aims a hand ray at a context ID, named target, or tagged target at ${ANGULAR_SPEED.default} degrees per second by default. Use it before click and while moving a ray-held object toward its destination.`,
    execute: (session, args) =>
      session.pointTo(
        handArg(args),
        requireTarget(args),
        angularSpeedOptions(args)
      ),
  },
  {
    name: 'reach_to_target',
    description:
      'Move the selected hand so its index fingertip reaches a live context ID, unique scene name, Devtools tag, or world position.',
    parameters: targetToolSchema(true, HAND_MOVE_SPEED, false),
    prompt: `reach_to_target smoothly moves the index fingertip into direct contact with a context ID, named target, or tagged target at ${HAND_MOVE_SPEED.default} meters per second by default. Do not use it for ordinary ray selection or ray dragging.`,
    execute: (session, args) =>
      session.reachTo(
        handArg(args),
        requireTarget(args),
        linearSpeedOptions(args, HAND_MOVE_SPEED)
      ),
  },
  {
    name: 'click',
    description: 'Perform a WebXR select gesture with the left or right hand.',
    prompt: 'click performs a quick select gesture with one hand.',
    parameters: {
      type: SchemaType.object,
      properties: {
        hand: {type: SchemaType.string, enum: ['left', 'right']},
        duration_ms: {type: SchemaType.integer},
      },
    },
    execute(session, args) {
      const durationMs = optionalPositiveNumber(
        args.duration_ms,
        'duration_ms'
      );
      return session.click(
        handArg(args),
        durationMs === undefined ? undefined : {durationMs}
      );
    },
  },
]);

export function agentActionDeclarations(profile: AgentToolProfile) {
  return agentActions(profile).map(({name, description, parameters}) => ({
    name,
    description,
    parameters,
  }));
}

export function agentActionPrompt(profile: AgentToolProfile) {
  return agentActions(profile)
    .flatMap((definition) => (definition.prompt ? [definition.prompt] : []))
    .join('\n');
}

export function executeAgentAction(
  session: XRBlocksSession,
  profile: AgentToolProfile,
  name: string,
  args: JsonObject
) {
  const definition = agentActions(profile).find(
    (candidate) => candidate.name === name
  );
  if (!definition) {
    throw new AgentActionError(
      `Autonomous runner tool ${name} is not available in the ${profile} profile.`
    );
  }
  return definition.execute(session, args);
}

function agentActions(profile: AgentToolProfile) {
  const names = AGENT_TOOL_PROFILES[profile];
  if (!names) {
    throw new AgentActionError(
      `Unknown autonomous runner tool profile: ${profile}`
    );
  }
  return AGENT_ACTIONS.filter(({name}) =>
    (names as readonly string[]).includes(name)
  );
}

function boundedWaitDuration(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < AGENT_WAIT_MIN_MS ||
    value > AGENT_WAIT_MAX_MS
  ) {
    throw new AgentActionError(
      `duration_ms must be an integer between ${AGENT_WAIT_MIN_MS} and ${AGENT_WAIT_MAX_MS}.`
    );
  }
  return value;
}

function requireTarget(args: JsonObject) {
  if (
    typeof args.target === 'string' ||
    isVec3(args.target) ||
    isTaggedTarget(args.target)
  ) {
    return args.target;
  }
  throw new AgentActionError(
    'Target must be a context ID, context name, Devtools tag, or vec3 tuple.'
  );
}

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentActionError(`${name} must be a non-empty string.`);
  }
  return value;
}

function angularSpeedOptions(args: JsonObject) {
  return {
    speedDegreesPerSecond: actionSpeed(
      optionalNumber(args.speed_degrees_per_second),
      ANGULAR_SPEED,
      'speed_degrees_per_second'
    ),
  };
}

function linearSpeedOptions(args: JsonObject, config: SpeedConfig) {
  return {
    speedMetersPerSecond: actionSpeed(
      optionalNumber(args.speed_meters_per_second),
      config,
      'speed_meters_per_second'
    ),
  };
}

function linearMotionArgs(args: JsonObject) {
  const config = args.hand === undefined ? VIEWER_MOVE_SPEED : HAND_MOVE_SPEED;
  return {
    rightMeters: optionalNumber(args.right_meters),
    upMeters: optionalNumber(args.up_meters),
    forwardMeters: optionalNumber(args.forward_meters),
    ...linearSpeedOptions(args, config),
  };
}

function rotationArgs(args: JsonObject) {
  return {
    pitchDegrees: optionalNumber(args.pitch_degrees),
    yawDegrees: optionalNumber(args.yaw_degrees),
    rollDegrees: optionalNumber(args.roll_degrees),
    ...angularSpeedOptions(args),
  };
}

function handArg(args: JsonObject): PhysicalHand {
  const hand = args.hand ?? 'right';
  if (hand === 'left' || hand === 'right') return hand;
  throw new AgentActionError('Hand must be left or right.');
}

function requiredHandArg(args: JsonObject): PhysicalHand {
  if (args.hand === undefined) throw new AgentActionError('Hand is required.');
  return handArg(args);
}

function poseArg(value: unknown): NamedHandPose {
  if (typeof value !== 'string')
    throw new AgentActionError('Pose must be a string.');
  if ((NAMED_HAND_POSES as readonly string[]).includes(value)) {
    return value as NamedHandPose;
  }
  throw new AgentActionError(
    `Pose must be one of: ${NAMED_HAND_POSES.join(', ')}.`
  );
}

function optionalPositiveNumber(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new AgentActionError(`${label} must be a positive finite number.`);
  }
  return value;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AgentActionError('Action numbers must be finite numbers.');
  }
  return value;
}

function actionSpeed(
  value: number | undefined,
  config: SpeedConfig,
  label: string
) {
  try {
    return boundedSpeed(value, config, label);
  } catch (error) {
    throw new AgentActionError(
      error instanceof Error ? error.message : String(error),
      {cause: error}
    );
  }
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => Number.isFinite(component))
  );
}

function isTaggedTarget(value: unknown): value is {tag: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as {tag?: unknown}).tag === 'string' &&
    Boolean((value as {tag: string}).tag.trim())
  );
}

function handToolSchema() {
  return {
    type: SchemaType.object,
    properties: {
      hand: {type: SchemaType.string, enum: ['left', 'right']},
    },
    required: ['hand'],
  };
}

function targetToolSchema(
  includeHand: boolean,
  speed: SpeedConfig,
  angular: boolean
) {
  const speedName = angular
    ? 'speed_degrees_per_second'
    : 'speed_meters_per_second';
  const properties: JsonObject = {
    target: {
      description:
        'A live context ID, exact scene/context name, [x,y,z] world position, or {"tag":"..."} Devtools target.',
      anyOf: [
        {type: SchemaType.string},
        {
          type: SchemaType.array,
          items: {type: SchemaType.number},
          minItems: 3,
          maxItems: 3,
        },
        {
          type: SchemaType.object,
          properties: {tag: {type: SchemaType.string}},
          required: ['tag'],
          additionalProperties: false,
        },
      ],
    },
    [speedName]: {
      type: SchemaType.number,
      minimum: speed.minimum,
      maximum: speed.maximum,
      description: `Movement speed in ${speed.units}; defaults to ${speed.default}.`,
    },
  };
  if (includeHand)
    properties.hand = {type: SchemaType.string, enum: ['left', 'right']};
  return {
    type: SchemaType.object,
    properties,
    required: includeHand ? ['hand', 'target'] : ['target'],
  };
}

function linearMotionSchema(speed: SpeedConfig, includeHand: boolean) {
  const properties: JsonObject = {
    right_meters: numberProperty('Positive moves right; negative moves left.'),
    up_meters: numberProperty('Positive moves up; negative moves down.'),
    forward_meters: numberProperty(
      'Positive moves forward; negative moves backward.'
    ),
    speed_meters_per_second: speedProperty(speed),
  };
  if (includeHand)
    properties.hand = {type: SchemaType.string, enum: ['left', 'right']};
  const schema: JsonObject = {type: SchemaType.object, properties};
  if (includeHand) schema.required = ['hand'];
  return schema;
}

function rotationSchema(includeHand: boolean) {
  const properties: JsonObject = {
    pitch_degrees: numberProperty('Positive pitches up.'),
    yaw_degrees: numberProperty('Positive yaws left.'),
    roll_degrees: numberProperty('Positive rolls counterclockwise.'),
    speed_degrees_per_second: speedProperty(ANGULAR_SPEED),
  };
  if (includeHand)
    properties.hand = {type: SchemaType.string, enum: ['left', 'right']};
  const schema: JsonObject = {type: SchemaType.object, properties};
  if (includeHand) schema.required = ['hand'];
  return schema;
}

function speedProperty(speed: SpeedConfig) {
  return {
    type: SchemaType.number,
    minimum: speed.minimum,
    maximum: speed.maximum,
    description: `Defaults to ${speed.default} ${speed.units}.`,
  };
}

function numberProperty(description: string) {
  return {type: SchemaType.number, description};
}
