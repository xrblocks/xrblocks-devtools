import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {
  HAND_JOINT_NAMES,
  Handedness,
  SIMULATOR_HAND_POSE_ROTATIONS,
  SimulatorHandPose,
  resolveSimulatorHandPoseRotations,
} from 'xrblocks';
import './runtime.js';

export default async function handPreview() {
  const options = window.__xrblocksVisualizerConfig.hand ?? {};
  const pose = options.pose ?? 'relaxed';
  const rotations = {
    ...SIMULATOR_HAND_POSE_ROTATIONS[pose as SimulatorHandPose],
    ...options.rotations,
  };
  const sides =
    options.hand === 'left' || options.hand === 'right'
      ? [options.hand]
      : ['left', 'right'];
  const loader = new GLTFLoader();
  const models = await Promise.all(
    sides.map(async (side) => {
      const {scene} = await loader.loadAsync(`/assets/${side}.glb`);
      const joints = resolveSimulatorHandPoseRotations(
        side === 'left' ? Handedness.LEFT : Handedness.RIGHT,
        rotations,
        false
      );
      const wrist = new THREE.Vector3().fromArray(joints[0].t);
      HAND_JOINT_NAMES.forEach((name, index) => {
        const bone = scene.getObjectByName(name);
        if (!bone) throw new Error(`Missing ${name} in ${side} hand model.`);
        bone.position.fromArray(joints[index].t).sub(wrist);
        bone.quaternion.fromArray(joints[index].r);
        bone.scale.setScalar(1);
      });
      scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(scene, true);
      scene.position.sub(bounds.getCenter(new THREE.Vector3()));
      return {scene, width: bounds.max.x - bounds.min.x};
    })
  );
  const group = new THREE.Group();
  const gap = 0.06;
  const totalWidth =
    models.reduce((sum, model) => sum + model.width, 0) +
    gap * (models.length - 1);
  let x = -totalWidth / 2;
  for (const {scene, width} of models) {
    scene.position.x += x + width / 2;
    x += width + gap;
    group.add(scene);
  }
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.computeBoundingSphere();
  });
  return group;
}
