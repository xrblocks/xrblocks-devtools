const SELECT_GESTURE_DURATION_MS = 200;

function getCore() {
  const core = window.xb?.core;
  if (!core) {
    throw new Error(
      'XR Blocks debug core is unavailable. Start the session with debug=1 and wait for window.xbReady.'
    );
  }
  return core;
}

function getCamera() {
  const core = getCore();
  return core.camera || core.simulator?.camera || window.xb?.camera;
}

function findSceneRoot(core) {
  return (
    core.scene ||
    core.root ||
    core.world?.scene ||
    core.renderer?.scene ||
    window.xb?.scene ||
    undefined
  );
}

function findAllByName(root, name) {
  const matches = [];
  root?.traverse?.((object) => {
    if (object?.name === name) matches.push(object);
  });
  return [...new Set(matches)];
}

function uniqueContextTargetsByName(detector, name) {
  if (!detector || typeof detector.resolveNodeObject !== 'function') return [];
  const products = [detector.tree, detector.visibleObjects, detector.setOfMark]
    .filter((product) => product && product.snapshotId)
    .sort(
      (left, right) =>
        Number(right.capturedAt || 0) - Number(left.capturedAt || 0)
    );
  const latestSnapshotId = products[0]?.snapshotId;
  if (!latestSnapshotId) return [];

  const nodeIds = new Set();
  for (const product of products) {
    if (product.snapshotId !== latestSnapshotId) continue;
    for (const node of Object.values(product.nodes || {})) {
      if (node?.name === name) nodeIds.add(node.id);
    }
    for (const mark of product.marks || []) {
      if (mark?.name === name) nodeIds.add(mark.nodeId);
    }
  }
  const objects = new Set();
  for (const nodeId of nodeIds) {
    const object = detector.resolveNodeObject(nodeId);
    if (object) objects.add(object);
  }
  return [...objects];
}

function requireUniqueTarget(matches, name, source) {
  if (matches.length > 1) {
    throw new Error(source + ' target name is ambiguous: ' + name);
  }
  return matches[0];
}

function resolveTarget(target) {
  if (Array.isArray(target)) return target;
  if (target && typeof target === 'object' && typeof target.tag === 'string') {
    return resolveTaggedTarget(target.tag, target.id);
  }
  if (typeof target !== 'string') {
    throw new Error(
      'Target must be a vec3 tuple, context ID, scene object name, or tagged object.'
    );
  }
  const core = getCore();
  const detector = core.context?.scene;
  const contextObjectById = detector?.resolveNodeObject?.(target);
  if (contextObjectById) return contextObjectById;

  const contextObject = requireUniqueTarget(
    uniqueContextTargetsByName(detector, target),
    target,
    'Context'
  );
  if (contextObject) return contextObject;

  const root = findSceneRoot(core);
  const object = requireUniqueTarget(
    findAllByName(root, target),
    target,
    'Scene'
  );
  if (!object) throw new Error('Context or scene target not found: ' + target);
  return object;
}

function getEmbodiedControl() {
  const embodiedControl = window.__xrblocksDevtoolsEmbodiedControl;
  if (!embodiedControl) {
    throw new Error(
      'Embodied controller unavailable. The harness is ready for observation, but embodied-control was not initialized.'
    );
  }
  return embodiedControl;
}

function ensureSimulatorHandsActive(core) {
  if (core.simulator?.controls?.simulatorMode !== 'Hands') {
    core.simulator?.controls?.setSimulatorMode('Hands');
  }
}

function configureSimulatorReachLimit(core, enabled) {
  if (enabled === undefined) return;
  const reachDistance = rawSimulatorReachDistance(core);
  if (!reachDistance) {
    throw new Error(
      'Simulator reach limit is unavailable in this XR Blocks runtime.'
    );
  }
  reachDistance.enabled = enabled;
}

async function configureSimulatorNavMesh(core, enabled) {
  if (enabled === undefined) return;
  const simulator = core.simulator;
  const navMesh =
    simulator?.options?.navMesh || core.options?.simulator?.navMesh;
  if (!navMesh || typeof simulator?.setEnvironment !== 'function') {
    throw new Error(
      'Simulator navmesh configuration is unavailable in this XR Blocks runtime.'
    );
  }

  navMesh.enabled = enabled;
  if (Boolean(simulator.userMovementConstrained) === enabled) return;

  const manifestPath = simulator.activeEnvironment?.manifestPath;
  if (!manifestPath) {
    throw new Error('The active simulator environment has no manifest path.');
  }
  await simulator.setEnvironment(manifestPath);
  if (enabled && !simulator.userMovementConstrained) {
    throw new Error(
      'The active simulator environment does not provide a usable navmesh.'
    );
  }
}

function getSimulatorReachDistance() {
  const reachDistance = simulatorReachConfiguration(getCore());
  return reachDistance?.enabled ? reachDistance : undefined;
}

function simulatorReachConfiguration(core) {
  const options = core.simulator?.options || core.options?.simulator;
  const reachDistance = options?.reachDistance;
  if (!reachDistance) return undefined;
  return {
    enabled: reachDistance.enabled,
    radius: reachDistance.radius,
    leftHandOrigin: options.leftHandOrigin || reachDistance.leftHandOrigin,
    rightHandOrigin: options.rightHandOrigin || reachDistance.rightHandOrigin,
  };
}

function rawSimulatorReachDistance(core) {
  return (
    core.simulator?.options?.reachDistance ||
    core.options?.simulator?.reachDistance
  );
}

function assertHandMovesReachable(control) {
  const reachDistance = getSimulatorReachDistance();
  if (!reachDistance || !control) return;
  assertHandMoveReachable(control.leftHand, 0, reachDistance);
  assertHandMoveReachable(control.rightHand, 1, reachDistance);
}

function assertHandMoveReachable(control, handIndex, reachDistance) {
  if (!control?.move) return;
  const state = getCore().simulator?.simulatorControllerState;
  const current = state?.localControllerPositions?.[handIndex];
  if (!current) return;
  const currentPosition = tuple3(current);
  if (!currentPosition) return;
  const move = control.move;
  const desired = [
    currentPosition[0] + Number(move[0]),
    currentPosition[1] + Number(move[1]),
    currentPosition[2] + Number(move[2]),
  ];
  assertReachablePosition(handIndex, desired, reachDistance, 'hand move');
}

function assertReachTarget(handIndex, target) {
  const reachDistance = getSimulatorReachDistance();
  if (!reachDistance) return;
  const camera = getCamera();
  const targetPosition = camera?.position?.clone?.();
  if (!targetPosition) return;
  if (Array.isArray(target)) {
    targetPosition.fromArray(target);
  } else if (target?.getWorldPosition) {
    target.getWorldPosition(targetPosition);
  } else {
    return;
  }
  targetPosition.applyMatrix4(camera.matrixWorldInverse);
  assertReachablePosition(
    handIndex,
    [targetPosition.x, targetPosition.y, targetPosition.z],
    reachDistance,
    'reach_to_target'
  );
}

function assertReachablePosition(handIndex, desired, reachDistance, action) {
  const origin =
    handIndex === 0
      ? reachDistance.leftHandOrigin
      : reachDistance.rightHandOrigin;
  if (!origin || !Number.isFinite(reachDistance.radius)) return;
  const dx = desired[0] - origin.x;
  const dy = desired[1] - origin.y;
  const dz = desired[2] - origin.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= reachDistance.radius + 1e-6) return;
  const hand = handIndex === 0 ? 'left' : 'right';
  const error = new Error(
    `Cannot ${action} with the ${hand} hand: desired position is ${distance.toFixed(3)}m from the hand origin, beyond the simulator reach limit of ${reachDistance.radius.toFixed(3)}m.`
  );
  error.name = 'SimulatorReachLimitError';
  error.code = 'SIMULATOR_REACH_LIMIT';
  throw error;
}

function selectControl(handIndex, event) {
  return handIndex === 0
    ? {leftHand: {[event]: true}}
    : {rightHand: {[event]: true}};
}

async function setSelecting(handIndex, selected) {
  const controller = getCore().input?.controllers?.[handIndex];
  if (controller?.userData?.selected === selected) {
    return {completed: true, unchanged: true};
  }
  await getEmbodiedControl().step({
    durationMs: SELECT_GESTURE_DURATION_MS,
    control: selectControl(handIndex, selected ? 'selectStart' : 'selectEnd'),
  });
  return {completed: true, unchanged: false};
}
