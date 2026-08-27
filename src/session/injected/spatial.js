function spatialMeasurement(object) {
  object.updateWorldMatrix?.(true, true);
  object.updateMatrixWorld?.(true);
  const renderableRoot = outputPresentationObject(object);
  renderableRoot.updateWorldMatrix?.(true, true);
  renderableRoot.updateMatrixWorld?.(true);
  const bounds = visibleRenderableBounds(renderableRoot);
  return {
    pose: objectTransform(object, 'world'),
    hasRenderableContent: bounds !== null,
    bounds,
  };
}

function viewMeasurement(object) {
  const spatial = spatialMeasurement(object);
  const renderableRoot = outputPresentationObject(object);
  const camera = measurementCamera();
  camera.updateProjectionMatrix?.();
  camera.updateWorldMatrix?.(true, false);
  camera.updateMatrixWorld?.(true);
  const effectivelyVisible =
    effectiveVisibility(object) && effectiveVisibility(renderableRoot);
  const hasVisibleRenderableContent = effectivelyVisible && spatial.hasRenderableContent;
  const cameraPosition = worldPosition(camera);
  const inFrustum =
    hasVisibleRenderableContent &&
    spatial.bounds !== null &&
    boundsIntersectCameraFrustum(spatial.bounds, camera);
  const screenBounds =
    inFrustum && spatial.bounds
      ? projectBoundsToScreen(spatial.bounds, camera, cameraPosition)
      : null;
  return {
    hasVisibleRenderableContent,
    effectivelyVisible,
    inFrustum,
    screenBounds,
    screenCoverage: screenBounds ? screenBounds.width * screenBounds.height : 0,
    cameraDistanceToOrigin: tupleDistance(cameraPosition, spatial.pose.position),
    cameraDistanceToBounds: spatial.bounds
      ? pointBoundsDistance(cameraPosition, spatial.bounds)
      : null,
  };
}

function outputPresentationObject(object) {
  return window.xb?.getUIPresentationObject?.(object) ?? object;
}

function visibleRenderableBounds(root) {
  let minimum;
  let maximum;
  const visit = (object, parentVisible) => {
    const visible = parentVisible && object?.visible !== false;
    if (!visible) return;
    const localBounds = renderableLocalBounds(object);
    if (localBounds) {
      const worldBounds = localBounds.clone().applyMatrix4(object.matrixWorld);
      if (!minimum) {
        minimum = tuple3(worldBounds.min);
        maximum = tuple3(worldBounds.max);
      } else {
        minimum = [Math.min(minimum[0], worldBounds.min.x), Math.min(minimum[1], worldBounds.min.y), Math.min(minimum[2], worldBounds.min.z)];
        maximum = [Math.max(maximum[0], worldBounds.max.x), Math.max(maximum[1], worldBounds.max.y), Math.max(maximum[2], worldBounds.max.z)];
      }
    }
    for (const child of object?.children || []) visit(child, visible);
  };
  visit(root, true);
  if (!minimum || !maximum) return null;
  const center = [(minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, (minimum[2] + maximum[2]) / 2];
  const size = subtractTuple(maximum, minimum);
  return {min: minimum, max: maximum, center, size, sphere: {center, radius: Math.hypot(...size) / 2}};
}

function renderableLocalBounds(object) {
  if (!object?.geometry) return undefined;
  object.computeBoundingBox?.();
  object.geometry.computeBoundingBox?.();
  return object.boundingBox || object.geometry.boundingBox || undefined;
}

function effectiveVisibility(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function measurementCamera() {
  const camera = getCamera()?.cameras?.[0] || getCamera();
  if (!camera?.projectionMatrix || !camera?.matrixWorldInverse) {
    throw new Error('View data requires an active projection camera.');
  }
  return camera;
}

function worldPosition(object) {
  object.updateWorldMatrix?.(true, false);
  object.updateMatrixWorld?.(true);
  const elements = object.matrixWorld?.elements;
  return elements ? [elements[12], elements[13], elements[14]] : tuple3(object.position);
}

function boundsCorners(bounds) {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  return [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, minZ], [minX, maxY, maxZ], [maxX, minY, minZ], [maxX, minY, maxZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]];
}

function viewProjectionElements(camera) {
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements;
}

function clipPoint(point, elements) {
  const [x, y, z] = point;
  return {x: elements[0] * x + elements[4] * y + elements[8] * z + elements[12], y: elements[1] * x + elements[5] * y + elements[9] * z + elements[13], z: elements[2] * x + elements[6] * y + elements[10] * z + elements[14], w: elements[3] * x + elements[7] * y + elements[11] * z + elements[15]};
}

function boundsIntersectCameraFrustum(bounds, camera) {
  const points = boundsCorners(bounds).map((point) => clipPoint(point, viewProjectionElements(camera)));
  return ![(point) => point.x < -point.w, (point) => point.x > point.w, (point) => point.y < -point.w, (point) => point.y > point.w, (point) => point.z < -point.w, (point) => point.z > point.w].some((test) => points.every(test));
}

function projectBoundsToScreen(bounds, camera, cameraPosition) {
  if (pointInsideBounds(cameraPosition, bounds)) return {left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1};
  const projected = boundsCorners(bounds).map((point) => clipPoint(point, viewProjectionElements(camera))).filter((point) => point.w > 0).map((point) => ({x: point.x / point.w, y: point.y / point.w}));
  if (projected.length === 0) return null;
  const left = clamp01((Math.min(...projected.map((point) => point.x)) + 1) / 2);
  const right = clamp01((Math.max(...projected.map((point) => point.x)) + 1) / 2);
  const top = clamp01((1 - Math.max(...projected.map((point) => point.y))) / 2);
  const bottom = clamp01((1 - Math.min(...projected.map((point) => point.y))) / 2);
  return {left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top)};
}

function pointBoundsDistance(point, bounds) {
  return Math.hypot(Math.max(bounds.min[0] - point[0], 0, point[0] - bounds.max[0]), Math.max(bounds.min[1] - point[1], 0, point[1] - bounds.max[1]), Math.max(bounds.min[2] - point[2], 0, point[2] - bounds.max[2]));
}

function pointInsideBounds(point, bounds) {
  return point[0] >= bounds.min[0] && point[0] <= bounds.max[0] && point[1] >= bounds.min[1] && point[1] <= bounds.max[1] && point[2] >= bounds.min[2] && point[2] <= bounds.max[2];
}

function subtractTuple(right, left) {
  return [right[0] - left[0], right[1] - left[1], right[2] - left[2]];
}

function tupleDistance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
