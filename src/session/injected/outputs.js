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
    surfaces: serializeDetectedSurfaces(three, outputs),
  };
}

function serializeOutputRecord(object, tag, three) {
  object.updateWorldMatrix?.(true, true);
  object.updateMatrixWorld?.(true);
  const spatial = spatialMeasurement(object);
  const presentation = outputPresentationObject(object);
  const renderables = serializeRenderables(presentation);
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
    path: outputPath(object, presentation, three),
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
  return (
    objectVisibleInScene(root) &&
    displayedRenderables(outputPresentationObject(root)).length > 0
  );
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
      vertexColors: serializeVertexColors(geometry?.attributes?.color),
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
    vertexColors: material.vertexColors === true,
  };
}

function serializeVertexColors(attribute) {
  if (!attribute || attribute.count === 0 || attribute.itemSize < 3) {
    return null;
  }
  const averageRgb = [0, 0, 0];
  let saturationTotal = 0;
  let minimumSaturation = Infinity;
  let maximumSaturation = -Infinity;
  for (let index = 0; index < attribute.count; index += 1) {
    const red = attribute.getX(index);
    const green = attribute.getY(index);
    const blue = attribute.getZ(index);
    averageRgb[0] += red;
    averageRgb[1] += green;
    averageRgb[2] += blue;
    const saturation = hslSaturation(red, green, blue);
    saturationTotal += saturation;
    minimumSaturation = Math.min(minimumSaturation, saturation);
    maximumSaturation = Math.max(maximumSaturation, saturation);
  }
  return {
    count: attribute.count,
    averageRgb: averageRgb.map((channel) => channel / attribute.count),
    averageHslSaturation: saturationTotal / attribute.count,
    minimumHslSaturation: minimumSaturation,
    maximumHslSaturation: maximumSaturation,
  };
}

function hslSaturation(red, green, blue) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const denominator = 1 - Math.abs(2 * lightness - 1);
  return denominator === 0 ? 0 : (maximum - minimum) / denominator;
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

function outputPath(object, renderableRoot, three) {
  const declared = devtoolsMetadata(object)?.output?.path;
  if (declared?.start && declared?.end) {
    return {start: tuple3(declared.start), end: tuple3(declared.end)};
  }
  let path = null;
  renderableRoot.traverse?.((object) => {
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

function serializeDetectedSurfaces(three, outputs) {
  const core = getCore();
  const simulatorPlanes =
    core.simulator?.simulatorWorld?.getSimulatorPlanes?.() || [];
  const planeSurfaces =
    simulatorPlanes.length > 0
      ? simulatorPlanes.map((plane, index) =>
          serializeSimulatorPlane(plane, index, three)
        )
      : (core.world?.planes?.get?.() || []).map((plane) => {
          plane.updateWorldMatrix?.(true, false);
          plane.updateMatrixWorld?.(true);
          const quaternion = new three.Quaternion();
          plane.getWorldQuaternion(quaternion);
          const normal = new three.Vector3(0, 1, 0).applyQuaternion(quaternion);
          return {
            id: plane.uuid,
            kind: 'plane',
            label: plane.label,
            position: worldPosition(plane),
            normal: tuple3(normal.normalize()),
            bounds: serializeOutputBounds(visibleRenderableBounds(plane)),
          };
        });
  const simulatorMeshes = [];
  core.simulator?.simulatorScene?.environmentRoot?.traverse?.((object) => {
    if (object.isMesh && object.geometry?.attributes?.position) {
      simulatorMeshes.push(object);
    }
  });
  const meshes =
    simulatorMeshes.length > 0
      ? simulatorMeshes
      : Array.from(
          core.world?.meshes?.xrMeshToThreeMesh?.values?.() || []
        );
  const meshSurfaces = meshes.map((mesh) => ({
    id: mesh.uuid,
    kind: 'mesh',
    label: mesh.semanticLabel || mesh.name || undefined,
    position: worldPosition(mesh),
    bounds: serializeOutputBounds(visibleRenderableBounds(mesh)),
    distanceByOutputId: Object.fromEntries(
      outputs
        .filter((output) => output.bounds)
        .map((output) => [
          output.id,
          distanceFromBoundsToMesh(output.bounds, mesh, three),
        ])
        .filter((entry) => Number.isFinite(entry[1]))
    ),
  }));
  return [...planeSurfaces, ...meshSurfaces];
}

function serializeSimulatorPlane(plane, index, three) {
  const normal = new three.Vector3(0, 1, 0)
    .applyQuaternion(plane.quaternion)
    .normalize();
  const points = plane.polygon.map((point) =>
    new three.Vector3(point.x, 0, point.y)
      .applyQuaternion(plane.quaternion)
      .add(plane.position)
  );
  const bounds = new three.Box3().setFromPoints(points);
  const center = bounds.getCenter(new three.Vector3());
  const size = bounds.getSize(new three.Vector3());
  return {
    id: `simulator-plane-${index}`,
    kind: 'plane',
    label: plane.label || plane.type,
    position: tuple3(plane.position),
    normal: tuple3(normal),
    bounds:
      points.length > 0
        ? {
            min: tuple3(bounds.min),
            max: tuple3(bounds.max),
            center: tuple3(center),
            size: tuple3(size),
          }
        : null,
  };
}

function distanceFromBoundsToMesh(bounds, root, three) {
  const samples = [bounds.center, ...boundsCorners(bounds)].map((point) =>
    new three.Vector3().fromArray(point)
  );
  const first = new three.Vector3();
  const second = new three.Vector3();
  const third = new three.Vector3();
  const closest = new three.Vector3();
  const triangle = new three.Triangle();
  let minimumDistanceSquared = Infinity;
  root.updateWorldMatrix?.(true, true);
  root.updateMatrixWorld?.(true);
  root.traverse?.((object) => {
    const position = object.geometry?.attributes?.position;
    if (!position) return;
    const index = object.geometry.index;
    const count = index?.count ?? position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      first
        .fromBufferAttribute(position, index?.getX(offset) ?? offset)
        .applyMatrix4(object.matrixWorld);
      second
        .fromBufferAttribute(position, index?.getX(offset + 1) ?? offset + 1)
        .applyMatrix4(object.matrixWorld);
      third
        .fromBufferAttribute(position, index?.getX(offset + 2) ?? offset + 2)
        .applyMatrix4(object.matrixWorld);
      triangle.set(first, second, third);
      for (const sample of samples) {
        triangle.closestPointToPoint(sample, closest);
        minimumDistanceSquared = Math.min(
          minimumDistanceSquared,
          closest.distanceToSquared(sample)
        );
      }
    }
  });
  return Math.sqrt(minimumDistanceSquared);
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
