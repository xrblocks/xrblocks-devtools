import type {JsonObject} from '../types.js';

export const DEFAULT_SESSION_TIMEOUT_MS = 300_000;

export type PhysicalHand = 'left' | 'right';

export const NAMED_HAND_POSES = [
  'neutral',
  'relaxed',
  'pinching',
  'fist',
  'thumbs_up',
  'pointing',
  'rock',
  'thumbs_down',
  'victory',
] as const;

export type NamedHandPose = (typeof NAMED_HAND_POSES)[number];

export const HAND_POSE_JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
] as const;

export type HandPoseJointName = (typeof HAND_POSE_JOINT_NAMES)[number];

/** Sparse named hand-joint rotations in radians. */
export type HandPoseRotations = Partial<
  Record<HandPoseJointName, [x: number, y: number, z: number]>
>;

export type LinearMotion = {
  /** Positive values move right in viewer space. */
  rightMeters?: number;
  /** Positive values move up in viewer space. */
  upMeters?: number;
  /** Positive values move forward in viewer space. */
  forwardMeters?: number;
  speedMetersPerSecond?: number;
};

export type EulerRotation = {
  /** Positive values pitch up. */
  pitchDegrees?: number;
  /** Positive values yaw left. */
  yawDegrees?: number;
  /** Positive values roll counterclockwise. */
  rollDegrees?: number;
  speedDegreesPerSecond?: number;
};

export type AngularSpeedOptions = {
  speedDegreesPerSecond?: number;
};

export type LinearSpeedOptions = {
  speedMetersPerSecond?: number;
};

export type BrowserDiagnostics = {
  consoleEntries: import('../types.js').JsonObject[];
  pageErrors: import('../types.js').JsonObject[];
  networkErrors: import('../types.js').JsonObject[];
};

export type Viewport = {
  width: number;
  height: number;
};

export type SceneContextOptions = {
  semanticTree?: boolean;
  visibleObjects?: boolean;
  setOfMark?: boolean;
};

export type RuntimeAssets = {
  xrblocksRoot: string;
  xrblocksBuildDir: string;
  nodeModulesDir: string;
  threeDir: string;
  threePathfindingDir?: string;
};

export type Vec3Tuple = [x: number, y: number, z: number];
export type QuaternionTuple = [x: number, y: number, z: number, w: number];

export type ObjectTransform = {
  position: Vec3Tuple;
  quaternion: QuaternionTuple;
  scale: Vec3Tuple;
};

export type ObjectIdentity = {
  id?: string;
  name: string;
  type: string;
};

export type ObjectInspection = ObjectIdentity & {
  tag?: string;
  state?: JsonObject;
  visible: boolean;
  parent?: ObjectIdentity;
  children: ObjectIdentity[];
  localTransform: ObjectTransform;
  worldTransform: ObjectTransform;
};

export type SimulatorPhysicsMode = false | 'fixed' | 'dynamic';

export type ThreeObjectInput = {
  toJSON(): unknown;
};

export type SimulatorObjectInput = {
  id?: string;
  tag?: string;
  state?: JsonObject;
  position?: Vec3Tuple;
  quaternion?: QuaternionTuple;
  scale?: Vec3Tuple;
  visible?: boolean;
  detectObject?: boolean;
  label?: string;
  physics?: SimulatorPhysicsMode;
  data?: unknown;
  assetPath?: string;
  file?: string;
  /** Three.js object serialized into the browser before simulator insertion. */
  object?: ThreeObjectInput;
};

export type SimulatorObjectUpdate = {
  id: string;
  position?: Vec3Tuple;
  quaternion?: QuaternionTuple;
  scale?: Vec3Tuple;
  visible?: boolean;
  detectObject?: boolean;
  label?: string | null;
  physics?: SimulatorPhysicsMode;
  data?: unknown;
};

export type SimulatorObjectRecord = {
  id: string;
  tag?: string;
  label?: string;
  position: Vec3Tuple;
  quaternion: QuaternionTuple;
  scale: Vec3Tuple;
  visible: boolean;
  physics?: SimulatorPhysicsMode;
};

export type SessionSimulator = {
  addObjects(
    definitions: SimulatorObjectInput[]
  ): Promise<SimulatorObjectRecord[]>;
  updateObjects(
    updates: SimulatorObjectUpdate[]
  ): Promise<SimulatorObjectRecord[]>;
  removeObjects(ids: string[]): Promise<void>;
  clearObjects(): Promise<void>;
  getObjects(ids?: string[]): Promise<SimulatorObjectRecord[]>;
};
