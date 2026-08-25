const OUTPUT_YAWS_DEGREES = [0, 90, 180, 270];

async function captureOutputSnapshot(options = {}) {
  const three = await outputThree();
  const root = findSceneRoot(getCore());
  const requestedTags = Array.isArray(options.tags)
    ? new Set(options.tags)
    : undefined;

  root?.updateWorldMatrix?.(true, true);
  root?.updateMatrixWorld?.(true);
  const camera = measurementCamera();
  camera.updateProjectionMatrix?.();
  camera.updateWorldMatrix?.(true, false);
  camera.updateMatrixWorld?.(true);

  const visibility = await captureSceneContextVisibility();
  const detector = getCore().context?.scene;

  const outputs = [];
  root?.traverse?.((object) => {
    const tag = devtoolsMetadata(object)?.tag;
    if (typeof tag !== 'string' || (requestedTags && !requestedTags.has(tag))) {
      return;
    }
    outputs.push(
      serializeOutputRecord(
        object,
        tag,
        camera,
        three,
        visibility.context,
        detector
      )
    );
  });
  outputs.sort(
    (left, right) =>
      left.tag.localeCompare(right.tag) || left.id.localeCompare(right.id)
  );

  return {
    outputs,
    surfaces: serializeDetectedSurfaces(three),
    visibility: visibility.context
      ? {
          available: true,
          snapshotId: visibility.context.snapshotId,
          capturedAt: visibility.context.capturedAt,
        }
      : {available: false, error: visibility.error},
  };
}

function serializeOutputRecord(object, tag, camera, three, visibleContext, detector) {
  object.updateWorldMatrix?.(true, true);
  object.updateMatrixWorld?.(true);
  const spatial = spatialMeasurement(object);
  const renderables = serializeRenderables(object);
  const contextView = outputContextView(object, visibleContext, detector);
  const projectedBounds =
    contextView?.inFrame && spatial.bounds
      ? projectBoundsToScreen(spatial.bounds, camera, worldPosition(camera))
      : null;
  return {
    id: object.uuid,
    tag,
    localTransform: objectTransform(object, 'local'),
    worldTransform: objectTransform(object, 'world'),
    bounds: serializeOutputBounds(spatial.bounds),
    render: {
      hasRenderableGeometry: renderables.some((entry) => entry.hasGeometry),
      rendered: contextView?.rendered ?? false,
      inFrustum: contextView?.inFrame ?? false,
      unoccluded: contextView?.inLineOfSight ?? false,
      screenBounds: projectedBounds,
      screenCoverage: projectedBounds
        ? projectedBounds.width * projectedBounds.height
        : 0,
      renderables,
    },
    text: visibleOutputText(object, contextView),
    path: outputPath(object, three),
  };
}

async function captureSceneContextVisibility() {
  try {
    const result = await runOneShotContextDetection({
      semanticTree: false,
      visibleObjects: true,
      setOfMark: false,
    });
    if (!result?.visibleObjects) {
      return {error: 'Scene Context did not return visible objects.'};
    }
    return {context: result.visibleObjects};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function outputContextView(object, visibleContext, detector) {
  if (!visibleContext || !detector?.resolveNodeObject) return null;
  const allNodes = Object.values(visibleContext.nodes || {});
  let nodes = allNodes.filter((node) => {
    const nodeObject = detector.resolveNodeObject(node.id);
    return nodeObject && outputContains(object, nodeObject);
  });
  if (nodes.length === 0) {
    nodes = allNodes.filter((node) => {
      const nodeObject = detector.resolveNodeObject(node.id);
      return nodeObject && outputContains(nodeObject, object);
    });
  }
  if (nodes.length === 0) {
    return {
      rendered: false,
      inFrame: false,
      inLineOfSight: false,
      nodes: [],
    };
  }
  const renderedNodes = nodes.filter((node) => node.view?.rendered === true);
  const framedNodes = renderedNodes.filter(
    (node) => node.view?.inFrame === true
  );
  const visibleNodes = framedNodes.filter(
    (node) => node.view?.inLineOfSight === true
  );
  return {
    rendered: renderedNodes.length > 0,
    inFrame: framedNodes.length > 0,
    inLineOfSight: visibleNodes.length > 0,
    nodes: visibleNodes,
  };
}

async function captureOutputYawVisibility(target, yaws = OUTPUT_YAWS_DEGREES) {
  const camera = getCamera();
  if (!camera?.quaternion) {
    throw new Error('Yaw visibility requires an active camera.');
  }
  const three = await outputThree();
  const originalQuaternion = camera.quaternion.clone();
  const detector = getCore().context?.scene;
  const targets = resolveOutputSelectorObjects(target);
  try {
    const views = [];
    for (const yawDegrees of yaws) {
      const yaw = new three.Quaternion().setFromAxisAngle(
        new three.Vector3(0, 1, 0),
        (yawDegrees * Math.PI) / 180
      );
      camera.quaternion.copy(yaw.multiply(originalQuaternion.clone()));
      camera.updateWorldMatrix?.(true, true);
      camera.updateMatrixWorld?.(true);
      const visibility = await captureSceneContextVisibility();
      const objectViews = targets.map((object) =>
        outputContextView(object, visibility.context, detector)
      );
      const hasVisibleMaterial = targets.some(outputHasVisibleMaterial);
      views.push({
        yawDegrees,
        visibilityAvailable: Boolean(visibility.context),
        rendered:
          hasVisibleMaterial &&
          objectViews.some((view) => view?.rendered === true),
        inFrustum: objectViews.some((view) => view?.inFrame === true),
        unoccluded: objectViews.some((view) => view?.inLineOfSight === true),
        error: visibility.error,
      });
    }
    return views;
  } finally {
    camera.quaternion.copy(originalQuaternion);
    camera.updateWorldMatrix?.(true, true);
    camera.updateMatrixWorld?.(true);
  }
}

function resolveOutputSelectorObjects(target) {
  const tag = typeof target === 'string' ? target : target?.tag;
  const id = typeof target === 'object' ? target?.id : undefined;
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error('Output target requires a non-empty tag.');
  }
  const matches = [];
  findSceneRoot(getCore())?.traverse?.((object) => {
    if (
      devtoolsMetadata(object)?.tag === tag &&
      (id === undefined || object.uuid === id)
    ) {
      matches.push(object);
    }
  });
  return matches;
}

function inspectOutputSelectorVisibility(target) {
  const targets = resolveOutputSelectorObjects(target);
  return {
    exists: targets.length > 0,
    visible: targets.some(objectVisibleInScene),
  };
}

function objectVisibleInScene(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function serializeRenderables(root) {
  const result = [];
  root.traverse?.((object) => {
    const geometry = object.geometry;
    if (!geometry) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    const hasGeometry = geometryHasContent(geometry);
    const materialState = materials.map(serializeMaterial);
    result.push({
      objectId: object.uuid,
      hasGeometry,
      geometry: geometryFingerprint(geometry),
      materials: materialState,
    });
  });
  return result;
}

function outputHasVisibleMaterial(root) {
  let visible = false;
  root.traverse?.((object) => {
    if (visible || !geometryHasContent(object.geometry)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    visible =
      materials.length === 0 ||
      materials.some(
        (material) =>
          material.visible !== false &&
          (material.transparent !== true || (material.opacity ?? 1) > 0)
      );
  });
  return visible;
}

function geometryHasContent(geometry) {
  const position = geometry?.attributes?.position;
  if (!position || position.count === 0) return false;
  const drawCount = geometry.drawRange?.count;
  return drawCount === undefined || drawCount === Infinity || drawCount > 0;
}

function serializeMaterial(material) {
  return {
    id: material.uuid,
    type: material.type || material.constructor?.name || 'Material',
    visible: material.visible !== false,
    color: outputColor(material.color),
    emissive: outputColor(material.emissive),
    emissiveIntensity: finiteOrNull(material.emissiveIntensity),
    opacity: finiteOrNull(material.opacity) ?? 1,
    transparent: material.transparent === true,
    wireframe: material.wireframe === true,
    side: finiteOrNull(material.side),
    depthTest: material.depthTest !== false,
    depthWrite: material.depthWrite !== false,
  };
}

function outputColor(color) {
  if (!color) return null;
  if (typeof color.getHexString === 'function') {
    return '#' + color.getHexString();
  }
  return Array.isArray(color) ? color.slice(0, 3) : [color.r, color.g, color.b];
}

function geometryFingerprint(geometry) {
  let hash = 2166136261;
  const addNumber = (value) => {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  const attributes = geometry?.attributes || {};
  for (const name of Object.keys(attributes).sort()) {
    const attribute = attributes[name];
    addNumber(name);
    addNumber(attribute.itemSize);
    addNumber(attribute.count);
    for (const value of attribute.array || []) addNumber(value);
  }
  const index = geometry?.index;
  if (index) {
    addNumber('index');
    for (const value of index.array || []) addNumber(value);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function visibleOutputText(root, contextView) {
  const declared = devtoolsMetadata(root)?.output?.text;
  if (typeof declared === 'string') return declared;
  const contextText = (contextView?.nodes || [])
    .filter((node) => typeof node.text === 'string')
    .map((node) => node.text)
    .filter((text) => text.length > 0);
  return contextText.length > 0 ? contextText.join('\n') : null;
}

function outputPath(root, three) {
  const declared = devtoolsMetadata(root)?.output?.path;
  if (declared?.start && declared?.end) {
    return {start: tuple3(declared.start), end: tuple3(declared.end)};
  }
  let path = null;
  root.traverse?.((object) => {
    if (path) return;
    const position = object.geometry?.attributes?.position;
    if (!position || position.count < 2) return;
    const start = new three.Vector3().fromBufferAttribute(position, 0);
    const end = new three.Vector3().fromBufferAttribute(
      position,
      position.count - 1
    );
    object.localToWorld(start);
    object.localToWorld(end);
    path = {start: tuple3(start), end: tuple3(end)};
  });
  return path;
}

function serializeDetectedSurfaces(three) {
  const planes = getCore().world?.planes?.get?.() || [];
  return planes.map((plane) => {
    plane.updateWorldMatrix?.(true, false);
    plane.updateMatrixWorld?.(true);
    const quaternion = new three.Quaternion();
    plane.getWorldQuaternion(quaternion);
    const normal = new three.Vector3(0, 1, 0).applyQuaternion(quaternion);
    return {
      id: plane.uuid,
      label: plane.label,
      position: worldPosition(plane),
      normal: tuple3(normal.normalize()),
      bounds: serializeOutputBounds(visibleRenderableBounds(plane)),
    };
  });
}

function serializeOutputBounds(bounds) {
  if (!bounds) return null;
  return {
    min: bounds.min,
    max: bounds.max,
    center: bounds.center,
    size: bounds.size,
  };
}

function outputContains(root, candidate) {
  for (let current = candidate; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

async function outputThree() {
  if (window.THREE) return window.THREE;
  if (typeof THREE !== 'undefined') return THREE;
  return import('three');
}
