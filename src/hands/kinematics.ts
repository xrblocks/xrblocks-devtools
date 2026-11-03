import * as THREE from 'three';
import {HAND_JOINT_NAMES} from './types.js';
import type {
  HandJointName,
  HandPoseJointName,
  HandPoseRotations,
  JointTransform,
  PhysicalHand,
} from './types.js';
import {
  LEFT_HAND_NEUTRAL,
  RIGHT_HAND_NEUTRAL,
  ANGLE_LIMITS_DEGREES,
} from './skeleton.js';

const HAND_JOINT_PARENT: Partial<Record<HandJointName, HandJointName>> = {
  'thumb-metacarpal': 'wrist',
  'thumb-phalanx-proximal': 'thumb-metacarpal',
  'thumb-phalanx-distal': 'thumb-phalanx-proximal',
  'thumb-tip': 'thumb-phalanx-distal',
  'index-finger-metacarpal': 'wrist',
  'index-finger-phalanx-proximal': 'index-finger-metacarpal',
  'index-finger-phalanx-intermediate': 'index-finger-phalanx-proximal',
  'index-finger-phalanx-distal': 'index-finger-phalanx-intermediate',
  'index-finger-tip': 'index-finger-phalanx-distal',
  'middle-finger-metacarpal': 'wrist',
  'middle-finger-phalanx-proximal': 'middle-finger-metacarpal',
  'middle-finger-phalanx-intermediate': 'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-distal': 'middle-finger-phalanx-intermediate',
  'middle-finger-tip': 'middle-finger-phalanx-distal',
  'ring-finger-metacarpal': 'wrist',
  'ring-finger-phalanx-proximal': 'ring-finger-metacarpal',
  'ring-finger-phalanx-intermediate': 'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-distal': 'ring-finger-phalanx-intermediate',
  'ring-finger-tip': 'ring-finger-phalanx-distal',
  'pinky-finger-metacarpal': 'wrist',
  'pinky-finger-phalanx-proximal': 'pinky-finger-metacarpal',
  'pinky-finger-phalanx-intermediate': 'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-distal': 'pinky-finger-phalanx-intermediate',
  'pinky-finger-tip': 'pinky-finger-phalanx-distal',
};

const HAND_JOINT_CHILD: Partial<Record<HandJointName, HandJointName>> = {};
for (const [child, parent] of Object.entries(HAND_JOINT_PARENT)) {
  if (parent !== 'wrist')
    HAND_JOINT_CHILD[parent as HandJointName] = child as HandJointName;
}

type RestJoint = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  localOffset: THREE.Vector3;
  localRotation: THREE.Quaternion;
  controlToBone: THREE.Quaternion;
};

function createRestJoints(
  joints: typeof LEFT_HAND_NEUTRAL | typeof RIGHT_HAND_NEUTRAL
) {
  const restJoints = new Map<HandJointName, RestJoint>();
  HAND_JOINT_NAMES.forEach((jointName, index) => {
    const joint = joints[index];
    const position = new THREE.Vector3(joint.t[0], joint.t[1], joint.t[2]);
    const rotation = new THREE.Quaternion(
      joint.r[0],
      joint.r[1],
      joint.r[2],
      joint.r[3]
    );
    const parentName = HAND_JOINT_PARENT[jointName];

    if (!parentName) {
      restJoints.set(jointName, {
        position,
        rotation,
        controlToBone: new THREE.Quaternion(),
        localOffset: position.clone(),
        localRotation: rotation.clone(),
      });
      return;
    }

    const parentRestJoint = restJoints.get(parentName)!;
    const inverseParentRotation = parentRestJoint.rotation.clone().invert();
    const localOffset = position
      .clone()
      .sub(parentRestJoint.position)
      .applyQuaternion(inverseParentRotation);
    const localRotation = parentRestJoint.rotation
      .clone()
      .invert()
      .multiply(rotation);

    restJoints.set(jointName, {
      position,
      rotation,
      controlToBone: new THREE.Quaternion(),
      localOffset,
      localRotation,
    });
  });
  const wrist = restJoints.get('wrist')!.position;
  const middle = restJoints.get('middle-finger-phalanx-proximal')!.position;
  const index = restJoints.get('index-finger-phalanx-proximal')!.position;
  const pinky = restJoints.get('pinky-finger-phalanx-proximal')!.position;
  const forward = middle.clone().sub(wrist).normalize();
  const radial = index.clone().sub(pinky).normalize();
  const palmarNormal = new THREE.Vector3()
    .crossVectors(forward, radial)
    .normalize();
  if (joints === RIGHT_HAND_NEUTRAL) palmarNormal.negate();

  for (const [jointName, joint] of restJoints) {
    const childName = HAND_JOINT_CHILD[jointName];
    const boneInverse = joint.rotation.clone().normalize().invert();
    const direction = childName
      ? restJoints.get(childName)!.localOffset.clone().normalize()
      : (jointName === 'wrist'
          ? forward.clone()
          : joint.position
              .clone()
              .sub(restJoints.get(HAND_JOINT_PARENT[jointName]!)!.position)
        )
          .applyQuaternion(boneInverse)
          .normalize();
    const isThumb = jointName.startsWith('thumb-');
    const bendToward = (
      jointName === 'thumb-metacarpal'
        ? middle.clone().sub(joint.position)
        : isThumb
          ? new THREE.Vector3(0, -1, 0).applyQuaternion(
              joint.rotation.clone().normalize()
            )
          : palmarNormal.clone()
    ).applyQuaternion(boneInverse);
    const x = new THREE.Vector3()
      .crossVectors(direction, bendToward)
      .normalize();
    const z = direction.clone().negate();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    joint.controlToBone.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(x, y, z)
    );
  }
  return restJoints;
}

const LEFT_REST_JOINTS = createRestJoints(LEFT_HAND_NEUTRAL);
const RIGHT_REST_JOINTS = createRestJoints(RIGHT_HAND_NEUTRAL);
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function constrainHandAngles(
  rotations: HandPoseRotations
): HandPoseRotations {
  const constrainedRotations: HandPoseRotations = {};

  for (const [jointName, rotation] of Object.entries(rotations)) {
    const jointConstraints =
      ANGLE_LIMITS_DEGREES[jointName as keyof typeof ANGLE_LIMITS_DEGREES];
    constrainedRotations[jointName as HandPoseJointName] = rotation.map(
      (axisValue, axisIndex) => {
        const axisConstraints = jointConstraints?.[axisIndex];
        if (!axisConstraints) return axisValue;

        const [minDegrees, maxDegrees] = axisConstraints;
        return (
          clamp(axisValue * RAD_TO_DEG, minDegrees, maxDegrees) * DEG_TO_RAD
        );
      }
    ) as [number, number, number];
  }

  return constrainedRotations;
}

function getControlAngles(
  handedness: PhysicalHand,
  jointName: HandJointName,
  rotation: [number, number, number]
): [number, number, number] {
  const mirror = handedness === 'right' ? -1 : 1;
  const spread =
    jointName.startsWith('ring-') || jointName.startsWith('pinky-') ? -1 : 1;
  const axial = jointName.startsWith('thumb-') ? -1 : 1;
  return [
    rotation[0],
    rotation[1] * mirror * spread,
    rotation[2] * mirror * axial,
  ];
}

function getOffsetRotation(
  handedness: PhysicalHand,
  jointName: HandJointName,
  restJoint: RestJoint,
  rotation: [number, number, number] = [0, 0, 0]
) {
  const [x, y, z] = getControlAngles(handedness, jointName, rotation);
  return restJoint.controlToBone
    .clone()
    .multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))
    )
    .multiply(restJoint.controlToBone.clone().invert());
}

function resolveSkeleton(
  handedness: PhysicalHand,
  restJoints: Map<HandJointName, RestJoint>,
  rotations: HandPoseRotations,
  applyConstraints = false
): JointTransform[] {
  const finalPositions = new Map<HandJointName, THREE.Vector3>();
  const finalRotations = new Map<HandJointName, THREE.Quaternion>();
  const resolvedJoints: JointTransform[] = [];
  const resolvedRotations = applyConstraints
    ? constrainHandAngles(rotations)
    : rotations;

  for (const jointName of HAND_JOINT_NAMES) {
    const restJoint = restJoints.get(jointName)!;
    const offsetRotation = getOffsetRotation(
      handedness,
      jointName,
      restJoint,
      resolvedRotations[jointName as HandPoseJointName]
    );
    const parentName = HAND_JOINT_PARENT[jointName];

    if (!parentName) {
      const finalPosition = restJoint.position.clone();
      const finalRotation = restJoint.rotation.clone().multiply(offsetRotation);
      finalPositions.set(jointName, finalPosition);
      finalRotations.set(jointName, finalRotation);
      resolvedJoints.push({
        t: finalPosition.toArray(),
        r: finalRotation.toArray(),
      });
      continue;
    }

    const parentPosition = finalPositions.get(parentName)!;
    const parentRotation = finalRotations.get(parentName)!;
    const finalPosition = restJoint.localOffset
      .clone()
      .applyQuaternion(parentRotation)
      .add(parentPosition);
    const finalRotation = parentRotation
      .clone()
      .multiply(restJoint.localRotation)
      .multiply(offsetRotation);
    finalPositions.set(jointName, finalPosition);
    finalRotations.set(jointName, finalRotation);
    resolvedJoints.push({
      t: finalPosition.toArray(),
      r: finalRotation.toArray(),
    });
  }

  return resolvedJoints;
}

export function resolveHandJoints(
  handedness: PhysicalHand,
  rotations: HandPoseRotations,
  applyConstraints = false
) {
  return resolveSkeleton(
    handedness,
    handedness === 'left' ? LEFT_REST_JOINTS : RIGHT_REST_JOINTS,
    rotations,
    applyConstraints
  );
}
