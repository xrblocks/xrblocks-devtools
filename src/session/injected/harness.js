async function init({
  embodiedControlImport,
  embodiedControlOptions,
  simulatorReachLimit,
  simulatorNavMesh,
} = {}) {
  await waitForCoreReady();
  const simulator = getSimulatorStatus();
  const deviceCamera = getSimulatorDeviceCameraStatus();
  const core = getCore();
  ensureSimulatorHandsActive(core);
  configureSimulatorReachLimit(core, simulatorReachLimit);
  await configureSimulatorNavMesh(core, simulatorNavMesh);
  if (window.__xrblocksDevtoolsEmbodiedControl) {
    await window.__xrblocksDevtoolsEmbodiedControl.ready;
    return {initialized: true, simulator, deviceCamera};
  }
  let EmbodiedControl;
  if (embodiedControlImport) {
    const module = await import(embodiedControlImport);
    EmbodiedControl = module.EmbodiedControl;
    if (!EmbodiedControl) {
      throw new Error(
        'EmbodiedControl export was not found in ' + embodiedControlImport
      );
    }
  }
  if (!EmbodiedControl) {
    return {initialized: false, simulator, deviceCamera};
  }
  const embodiedControl = new EmbodiedControl({
    autoPause: true,
    ...(embodiedControlOptions || {}),
  });
  embodiedControl.init({
    core,
    camera: getCamera(),
  });
  window.__xrblocksDevtoolsEmbodiedControl = embodiedControl;
  await embodiedControl.ready;
  return {initialized: true, simulator, deviceCamera};
}

function ready() {
  const simulator = getSimulatorStatus();
  const deviceCamera = getSimulatorDeviceCameraStatus();
  return {ready: true, simulator, deviceCamera};
}

async function setSimulatorEnvironment(scene) {
  const core = getCore();
  const simulator = core.simulator;
  if (typeof simulator?.setEnvironment !== 'function') {
    throw new Error('XR Blocks simulator environment loading is unavailable.');
  }

  if (typeof scene === 'string') {
    const environments = core.options?.simulator?.environments || [];
    const environment = environments.find(
      (candidate) => candidate.name === scene
    );
    if (!environment) {
      const names = environments
        .map((candidate) => candidate.name)
        .filter(Boolean)
        .join(', ');
      throw new Error(
        `Unknown XR Blocks simulator environment: ${scene}. Available environments: ${names || 'none'}.`
      );
    }
    await simulator.setEnvironment(scene, environment.manifestPath);
  } else if (
    scene &&
    typeof scene === 'object' &&
    typeof scene.path === 'string' &&
    scene.path.length > 0
  ) {
    await simulator.setEnvironment(new URL(scene.path, location.href).href);
  } else {
    throw new Error(
      'A simulator environment must be an SDK environment name or {path: string}.'
    );
  }

  core.stepFrame?.();
  await Promise.resolve();
  return {loaded: true, scene};
}

async function observeCamera(args = {}) {
  const result = objectPose(getCamera());
  if (args.screenshot) {
    result.screenshot = await getScreenshot(args);
  }
  return result;
}

function observeHands() {
  const core = getCore();
  const simulator = core.simulator;
  const input = core.input;
  const state = simulator?.simulatorControllerState;
  const hand = (handIndex) => {
    const controller =
      handIndex === 0
        ? simulator?.hands?.leftController
        : simulator?.hands?.rightController;
    const inputController = input?.controllers?.[handIndex];
    return {
      position: tuple3(state?.localControllerPositions?.[handIndex]),
      quaternion: tuple4(state?.localControllerOrientations?.[handIndex]),
      selected: !!inputController?.userData?.selected,
      squeezing: !!inputController?.userData?.squeezing,
      visible: controller?.visible ?? false,
    };
  };
  return {leftHand: hand(0), rightHand: hand(1)};
}

function observeSimulatorState() {
  const core = getCore();
  return {
    timestampMs:
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
    simulatorRunning: !!core.simulatorRunning,
    paused: !!core.isPaused,
  };
}

function observeScene() {
  const core = getCore();
  const root = findSceneRoot(core);
  return {
    url: location.href,
    simulator: observeSimulatorState(),
    camera: objectPose(getCamera()),
    objects: root ? [serializeObject(root)] : [],
    world: {
      objects: core.world?.objects?.objects,
      humans: core.world?.humans?.humans,
      faces: core.world?.faces?.faces,
    },
  };
}

function observeObject(args = {}) {
  return serializeInspectedObject(resolveTarget(args.target));
}

async function navigateTo(target) {
  const simulator = getCore().simulator;
  if (typeof simulator?.moveUser !== 'function') {
    throw new Error('XR Blocks simulator navigation is unavailable.');
  }
  const destination = resolveNavigationPosition(target);
  simulator.moveUser(destination);
  getCore().stepFrame?.();
  await Promise.resolve();
  return {
    completed: true,
    position: tuple3(getCamera()?.position),
    constrained: Boolean(simulator.userMovementConstrained),
  };
}

function resolveNavigationPosition(target) {
  const resolved = resolveTarget(target);
  const camera = getCamera();
  const position = camera?.position?.clone?.();
  if (!position) {
    throw new Error(
      'XR Blocks simulator navigation requires an active camera.'
    );
  }
  if (Array.isArray(resolved)) {
    if (
      resolved.length !== 3 ||
      resolved.some((value) => !Number.isFinite(value))
    ) {
      throw new Error('Navigation position must contain three finite numbers.');
    }
    return position.fromArray(resolved);
  }
  if (typeof resolved?.getWorldPosition !== 'function') {
    throw new Error('Navigation target does not provide a world position.');
  }
  return resolved.getWorldPosition(position);
}

function getDevtoolsContext(options = {}) {
  const includeLocations = options.locations === true;
  const includeTags = options.tags === true;
  const includeState = options.state === true;
  const includeSpatial = options.spatial === true;
  const includeView = options.view === true;
  const result = {};
  if (includeLocations) {
    result.locations = getCore().simulator.getLocations();
  }
  if (includeTags) result.tags = [];
  if (includeState) result.state = [];
  if (includeSpatial) result.spatial = [];
  if (includeView) result.view = [];
  findSceneRoot(getCore())?.traverse?.((object) => {
    const metadata = devtoolsMetadata(object);
    if (!metadata) return;
    const identity = objectIdentity(object);
    if (includeTags && typeof metadata.tag === 'string') {
      result.tags.push({...identity, tag: metadata.tag});
    }
    if (includeState && metadata.state && typeof metadata.state === 'object') {
      result.state.push({...identity, state: serializeDeclaredState(object)});
    }
    if (includeSpatial) {
      result.spatial.push({...identity, spatial: spatialMeasurement(object)});
    }
    if (includeView) {
      result.view.push({...identity, view: viewMeasurement(object)});
    }
  });
  return result;
}

function getSimulatorObjectsManager() {
  const core = getCore();
  const manager = core.simulator?.objects;
  if (!manager || typeof manager.addObjects !== 'function') {
    throw new Error('XR Blocks simulator objects manager is unavailable.');
  }
  return manager;
}

function serializeSimulatorObjectRecord(record) {
  const object = record?.object;
  const definition = record?.definition || {};
  return {
    id: record?.id,
    tag: devtoolsMetadata(object)?.tag,
    label: definition?.label,
    position: tuple3(object?.position),
    quaternion: tuple4(object?.quaternion),
    scale: tuple3(object?.scale),
    visible: object?.visible !== false,
    physics: definition?.physics || false,
  };
}

async function addSimulatorObjects(definitions = []) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    return [];
  }
  const manager = getSimulatorObjectsManager();
  const materialized = await Promise.all(
    definitions.map(materializeSimulatorObjectDefinition)
  );
  const records = await manager.addObjects(materialized, {
    baseUrl: location.href,
  });

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const def = definitions[index] || {};
    const meta = {};
    if (typeof def.tag === 'string') meta.tag = def.tag;
    if (def.state && typeof def.state === 'object') meta.state = def.state;
    if (meta.tag || meta.state) {
      record.object.userData = record.object.userData || {};
      record.object.userData[DEVTOOLS_METADATA_KEY] = {
        ...(record.object.userData[DEVTOOLS_METADATA_KEY] || {}),
        ...meta,
      };
    }
  }

  getCore().stepFrame?.();
  await Promise.resolve();
  return records.map(serializeSimulatorObjectRecord);
}

async function materializeSimulatorObjectDefinition(definition) {
  if (!definition?.objectJson) return definition;
  const three = window.THREE ?? (await import('three'));
  const {objectJson, ...rest} = definition;
  return {
    ...rest,
    object: new three.ObjectLoader().parse(objectJson),
  };
}

async function updateSimulatorObjects(updates = []) {
  const manager = getSimulatorObjectsManager();
  const records = await manager.updateObjects(updates);
  getCore().stepFrame?.();
  await Promise.resolve();
  return records.map(serializeSimulatorObjectRecord);
}

function removeSimulatorObjects(ids = []) {
  const manager = getSimulatorObjectsManager();
  manager.removeObjects(ids);
  getCore().stepFrame?.();
  return {completed: true};
}

function clearSimulatorObjects() {
  const manager = getSimulatorObjectsManager();
  manager.clear();
  getCore().stepFrame?.();
  return {completed: true};
}

function getSimulatorObjects(ids) {
  const manager = getSimulatorObjectsManager();
  const records = manager.get(ids);
  return records.map(serializeSimulatorObjectRecord);
}

const observations = {
  getCamera: observeCamera,
  getHands: observeHands,
  getScreenshot,
  getContextTree,
  getContextVisibleObjects,
  getContextSetOfMark,
  getSceneContext,
  getSimulatorState: observeSimulatorState,
  inspectScene: observeScene,
  inspectObject: observeObject,
};

window.__xrblocksDevtoolsRuntime = {
  init,
  ready,
  setSimulatorEnvironment,
  resolveTarget,
  findObjectsByTag,
  navigateTo,
  getDevtoolsContext,
  captureOutputSnapshot,
  inspectOutputVisibility,
  addSimulatorObjects,
  updateSimulatorObjects,
  removeSimulatorObjects,
  clearSimulatorObjects,
  getSimulatorObjects,
  async observe(tool, args = {}) {
    const observation = observations[tool];
    if (!observation) {
      throw new Error('Unknown observation tool: ' + tool);
    }
    return observation(args);
  },
  ...observations,
  async teleportTo(target, options) {
    await getEmbodiedControl().teleportTo(resolveTarget(target), options);
    return {completed: true};
  },
  async stepControl(step) {
    assertHandMovesReachable(step?.control);
    await getEmbodiedControl().step(step || {});
    return {completed: true};
  },
  applyControl(control) {
    assertHandMovesReachable(control);
    getEmbodiedControl().applyControl(control || {});
    return {completed: true};
  },
  startSelect: (handIndex = 1) => setSelecting(handIndex, true),
  endSelect: (handIndex = 1) => setSelecting(handIndex, false),
  async lookAtTarget(target, options) {
    await getEmbodiedControl().lookAtTarget(resolveTarget(target), options);
    return {completed: true};
  },
  async pointTo(handIndex, target, options) {
    await getEmbodiedControl().pointTo(
      handIndex,
      resolveTarget(target),
      options
    );
    return {completed: true};
  },
  async reachTo(handIndex, target, options) {
    const resolvedTarget = resolveTarget(target);
    assertReachTarget(handIndex, resolvedTarget);
    await getEmbodiedControl().reachTo(handIndex, resolvedTarget, options);
    return {completed: true};
  },
  async click(handIndex = 1, options) {
    await getEmbodiedControl().click(handIndex, options);
    return {completed: true};
  },
  async wait(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('Wait durationMs must be a positive finite number.');
    }
    const core = getCore();
    const startedAtMs = performance.now();
    let advancedMs = 0;
    while (advancedMs < durationMs) {
      const frameTimeMs = await new Promise((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(resolve);
        } else {
          setTimeout(() => resolve(performance.now()), 1000 / 60);
        }
      });
      const targetMs = Math.min(
        durationMs,
        Math.max(advancedMs, frameTimeMs - startedAtMs)
      );
      while (advancedMs < targetMs) {
        const stepMs = Math.min(1000 / 60, targetMs - advancedMs);
        core.stepFrame?.(stepMs);
        advancedMs += stepMs;
      }
    }
    return {completed: true, durationMs};
  },
  async stepFrame(frames = 1) {
    const core = getCore();
    for (let index = 0; index < frames; index += 1) {
      // Use Core's default 16.67 ms timestep so manual frames advance
      // simulation time instead of only rerunning the update loop.
      core.stepFrame?.();
      // Let post-frame observers sample before advancing another manual frame.
      await Promise.resolve();
    }
    return {completed: true, frames};
  },
};
