async function captureOutputSnapshot(options = {}) {
  const three = await outputThree();
  const root = findSceneRoot(getCore());
  const requestedTags = Array.isArray(options.tags)
    ? new Set(options.tags)
    : undefined;

  root?.updateWorldMatrix?.(true, true);
  root?.updateMatrixWorld?.(true);

  const outputs = [];
  root?.traverse?.((object) => {
    const tag = devtoolsMetadata(object)?.tag;
    if (typeof tag !== 'string' || (requestedTags && !requestedTags.has(tag))) {
      return;
    }
    outputs.push(serializeOutputRecord(object, tag, three));
  });
  outputs.sort(
    (left, right) =>
      left.tag.localeCompare(right.tag) || left.id.localeCompare(right.id)
  );

  return {
    outputs,
    surfaces: serializeDetectedSurfaces(three),
  };
}

function serializeOutputRecord(object, tag, three) {
  object.updateWorldMatrix?.(true, true);
  object.updateMatrixWorld?.(true);
  const spatial = spatialMeasurement(object);
  const renderables = serializeRenderables(object);
  return {
    id: object.uuid,
    tag,
    localTransform: objectTransform(object, 'local'),
    worldTransform: objectTransform(object, 'world'),
    bounds: serializeOutputBounds(spatial.bounds),
    render: {
      displayed: outputIsDisplayed(object),
      renderables,
    },
    text: visibleOutputText(object),
    path: outputPath(object, three),
  };
}

function inspectOutputVisibility(target) {
  const targets = resolveOutputSelectorObjects(target);
  const displayedTargets = targets.filter(outputIsDisplayed);
  return {
    exists: targets.length > 0,
    visible: displayedTargets.length > 0,
  };
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

function outputIsDisplayed(root) {
  const presentation = window.xb.getUIPresentationObject(root);
  return displayedRenderables(presentation ?? root).length > 0;
}

function displayedRenderables(root) {
  const renderables = [];
  root?.traverse?.((object) => {
    if (
      objectVisibleInScene(object) &&
      geometryHasContent(object.geometry) &&
      objectHasVisibleMaterial(object)
    ) {
      renderables.push(object);
    }
  });
  return renderables;
}

function objectVisibleInScene(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function objectHasVisibleMaterial(object) {
  const materials = Array.isArray(object.material)
    ? object.material
    : object.material
      ? [object.material]
      : [];
  return (
    materials.length === 0 ||
    materials.some(
      (material) =>
        material.visible !== false &&
        (material.transparent !== true || (material.opacity ?? 1) > 0)
    )
  );
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

function visibleOutputText(root) {
  const declared = devtoolsMetadata(root)?.output?.text;
  return typeof declared === 'string' ? declared : null;
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

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

async function outputThree() {
  if (window.THREE) return window.THREE;
  if (typeof THREE !== 'undefined') return THREE;
  return import('three');
}
