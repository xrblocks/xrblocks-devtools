import type {EulerRotation, LinearMotion} from './types.js';

export type SpeedConfig = {
  default: number;
  minimum: number;
  maximum: number;
  units: string;
};

export const VIEWER_MOVE_SPEED: SpeedConfig = {
  default: 6,
  minimum: 0.05,
  maximum: 20,
  units: 'meters per second',
};

export const HAND_MOVE_SPEED: SpeedConfig = {
  default: 3,
  minimum: 0.05,
  maximum: 20,
  units: 'meters per second',
};

export const ANGULAR_SPEED: SpeedConfig = {
  default: 720,
  minimum: 5,
  maximum: 3600,
  units: 'degrees per second',
};

export const HAND_POSE_TRANSITION_MS = 500;

export function linearMotionStep(
  motion: LinearMotion,
  speedConfig: SpeedConfig
) {
  const right = finiteComponent(motion.rightMeters, 'rightMeters');
  const up = finiteComponent(motion.upMeters, 'upMeters');
  const forward = finiteComponent(motion.forwardMeters, 'forwardMeters');
  const distance = Math.hypot(right, up, forward);
  if (distance === 0) {
    throw new Error('Linear motion must include a non-zero distance.');
  }
  const speed = boundedSpeed(
    motion.speedMetersPerSecond,
    speedConfig,
    'speedMetersPerSecond'
  );
  return {
    durationMs: (distance / speed) * 1000,
    // Embodied control uses camera-space +X right, +Y up, and -Z forward.
    move: [right, up, forward === 0 ? 0 : -forward] as [number, number, number],
  };
}

export function angularMotionStep(rotation: EulerRotation) {
  const pitch = finiteComponent(rotation.pitchDegrees, 'pitchDegrees');
  const yaw = finiteComponent(rotation.yawDegrees, 'yawDegrees');
  const roll = finiteComponent(rotation.rollDegrees, 'rollDegrees');
  const displacementDegrees = Math.hypot(pitch, yaw, roll);
  if (displacementDegrees === 0) {
    throw new Error('Rotation must include a non-zero angle.');
  }
  const speed = boundedSpeed(
    rotation.speedDegreesPerSecond,
    ANGULAR_SPEED,
    'speedDegreesPerSecond'
  );
  return {
    durationMs: (displacementDegrees / speed) * 1000,
    rotate: [pitch, yaw, roll] as [number, number, number],
  };
}

export function boundedSpeed(
  requested: number | undefined,
  config: SpeedConfig,
  label: string
) {
  const speed = requested ?? config.default;
  if (
    !Number.isFinite(speed) ||
    speed < config.minimum ||
    speed > config.maximum
  ) {
    throw new Error(
      `${label} must be between ${config.minimum} and ${config.maximum} ${config.units}.`
    );
  }
  return speed;
}

function finiteComponent(value: number | undefined, label: string) {
  const component = value ?? 0;
  if (!Number.isFinite(component)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return component;
}
