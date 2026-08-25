import type {XRBlocksSession} from '../session/index.js';
import {Box3, Quaternion, Vector3} from 'three';
import type {
  OutputBounds,
  OutputChangeField,
  OutputRecord,
  OutputSelector,
  OutputSnapshot,
  OutputYawView,
} from './output-types.js';

const DEFAULT_POSITION_TOLERANCE_METERS = 0.001;
const DEFAULT_ROTATION_TOLERANCE_DEGREES = 0.1;
const DEFAULT_SCALE_TOLERANCE = 0.001;

export async function captureOutputSnapshot(
  session: XRBlocksSession,
  options: {tags?: string[]} = {}
): Promise<OutputSnapshot> {
  return session.invoke<OutputSnapshot>('captureOutputSnapshot', options);
}

export function expectRenderedTag(
  snapshot: OutputSnapshot,
  target: OutputSelector,
  options: {
    count?: number;
    minScreenCoverage?: number;
    unoccluded?: boolean;
  } = {}
): void {
  requireVisibility(snapshot);
  const matches = selectOutputs(snapshot, target);
  const expectedCount = options.count ?? 1;
  if (matches.length !== expectedCount) {
    fail(
      `Expected ${selectorLabel(target)} count ${expectedCount}, but found ${matches.length}.`
    );
  }
  for (const output of matches) {
    if (!output.render.hasRenderableGeometry) {
      fail(`${outputLabel(output)} has no renderable geometry.`);
    }
    if (!outputHasVisibleMaterial(output)) {
      fail(`${outputLabel(output)} has no visible render material.`);
    }
    if (!output.render.rendered) {
      fail(`${outputLabel(output)} was not reported as rendered.`);
    }
    if (!output.render.inFrustum) {
      fail(`${outputLabel(output)} was rendered outside the camera frame.`);
    }
    if (options.unoccluded && !output.render.unoccluded) {
      fail(`${outputLabel(output)} is not in line of sight in Scene Context.`);
    }
    if (!output.render.screenBounds) {
      fail(`${outputLabel(output)} has no projected screen extent.`);
    }
    const minimum = options.minScreenCoverage ?? Number.EPSILON;
    if (output.render.screenCoverage < minimum) {
      fail(
        `${outputLabel(output)} screen coverage ${output.render.screenCoverage} is less than ${minimum}.`
      );
    }
  }
}

export async function expectVisibleFromAnyYaw(
  session: XRBlocksSession,
  target: OutputSelector,
  options: {yaws?: number[]} = {}
): Promise<void> {
  const yaws = options.yaws ?? [0, 90, 180, 270];
  const views = await session.invoke<OutputYawView[]>(
    'captureOutputYawVisibility',
    normalizeSelector(target),
    yaws
  );
  const unavailable = views.find((view) => !view.visibilityAvailable);
  if (unavailable) {
    fail(
      `Scene Context visibility was unavailable at yaw ${unavailable.yawDegrees}: ${unavailable.error ?? 'unknown error'}.`
    );
  }
  if (!views.some((view) => view.rendered && view.inFrustum)) {
    fail(
      `${selectorLabel(target)} was not rendered in frame at yaws ${yaws.join(', ')} degrees.`
    );
  }
}

export async function expectNotVisible(
  session: XRBlocksSession,
  target: OutputSelector,
  options: {yaws?: number[]} = {}
): Promise<void> {
  const yaws = options.yaws ?? [0, 90, 180, 270];
  const selector = normalizeSelector(target);
  const objectVisibility = await session.invoke<{
    exists: boolean;
    visible: boolean;
  }>('inspectOutputSelectorVisibility', selector);
  if (!objectVisibility.exists || !objectVisibility.visible) return;
  const views = await session.invoke<OutputYawView[]>(
    'captureOutputYawVisibility',
    selector,
    yaws
  );
  const unavailable = views.find((view) => !view.visibilityAvailable);
  if (unavailable) {
    fail(
      `Scene Context visibility was unavailable at yaw ${unavailable.yawDegrees}: ${unavailable.error ?? 'unknown error'}.`
    );
  }
  const visibleYaws = views
    .filter((view) => view.rendered && view.inFrustum)
    .map((view) => view.yawDegrees);
  if (visibleYaws.length > 0) {
    fail(
      `${selectorLabel(target)} was rendered in frame at yaws ${visibleYaws.join(', ')} degrees.`
    );
  }
}

export function expectCreatedOrRemoved(
  before: OutputSnapshot,
  after: OutputSnapshot,
  target: OutputSelector,
  expected: {created?: number; removed?: number}
): void {
  const selector = normalizeSelector(target);
  const beforeIds = new Set(before.outputs.map((output) => output.id));
  const afterIds = new Set(after.outputs.map((output) => output.id));
  const created = after.outputs.filter(
    (output) => !beforeIds.has(output.id) && matchesSelector(output, selector)
  ).length;
  const removed = before.outputs.filter(
    (output) => !afterIds.has(output.id) && matchesSelector(output, selector)
  ).length;
  if (expected.created !== undefined && created !== expected.created) {
    fail(
      `Expected ${selectorLabel(target)} to create ${expected.created}, but created ${created}.`
    );
  }
  if (expected.removed !== undefined && removed !== expected.removed) {
    fail(
      `Expected ${selectorLabel(target)} to remove ${expected.removed}, but removed ${removed}.`
    );
  }
}

export function expectTransformChanged(
  before: OutputSnapshot,
  after: OutputSnapshot,
  target: OutputSelector,
  options: {
    positionMeters?: number;
    rotationDegrees?: number;
    scale?: number;
  } = {}
): void {
  const [left, right] = requireSharedOutput(before, after, target);
  const checks = [];
  if (options.positionMeters !== undefined) {
    checks.push(
      distance(left.worldTransform.position, right.worldTransform.position) >
        options.positionMeters
    );
  }
  if (options.rotationDegrees !== undefined) {
    checks.push(
      quaternionAngleDegrees(
        left.worldTransform.quaternion,
        right.worldTransform.quaternion
      ) > options.rotationDegrees
    );
  }
  if (options.scale !== undefined) {
    checks.push(
      maxTupleDifference(
        left.worldTransform.scale,
        right.worldTransform.scale
      ) > options.scale
    );
  }
  if (checks.length === 0) {
    checks.push(
      distance(left.worldTransform.position, right.worldTransform.position) >
        DEFAULT_POSITION_TOLERANCE_METERS,
      quaternionAngleDegrees(
        left.worldTransform.quaternion,
        right.worldTransform.quaternion
      ) > DEFAULT_ROTATION_TOLERANCE_DEGREES,
      maxTupleDifference(
        left.worldTransform.scale,
        right.worldTransform.scale
      ) > DEFAULT_SCALE_TOLERANCE
    );
  }
  if (!checks.some(Boolean)) {
    fail(`${outputLabel(right)} transform did not change beyond tolerance.`);
  }
}

export type SpatialRelation =
  | 'near'
  | 'aligned'
  | 'above'
  | 'inside'
  | 'touching'
  | 'non-overlapping'
  | 'symmetric'
  | 'matched';

export function expectSpatialRelation(
  snapshot: OutputSnapshot,
  leftTarget: OutputSelector,
  relation: SpatialRelation,
  rightTarget: OutputSelector,
  options: {
    toleranceMeters?: number;
    rotationToleranceDegrees?: number;
    scaleTolerance?: number;
    axis?: 'x' | 'y' | 'z' | 'all';
    symmetryCenter?: number;
  } = {}
): void {
  const left = requireOne(snapshot, leftTarget);
  const right = requireOne(snapshot, rightTarget);
  const tolerance = options.toleranceMeters ?? 0.01;
  const axis = options.axis ?? 'all';
  const leftBounds = requireBounds(left);
  const rightBounds = requireBounds(right);
  let passes = false;
  switch (relation) {
    case 'near':
      passes = distance(leftBounds.center, rightBounds.center) <= tolerance;
      break;
    case 'aligned': {
      const axes = axis === 'all' ? [0, 1, 2] : [axisIndex(axis)];
      passes = axes.every(
        (index) =>
          Math.abs(leftBounds.center[index] - rightBounds.center[index]) <=
          tolerance
      );
      break;
    }
    case 'above':
      passes = leftBounds.min[1] >= rightBounds.max[1] - tolerance;
      break;
    case 'inside':
      passes = boundsContains(rightBounds, leftBounds, tolerance);
      break;
    case 'touching':
      passes = boundsDistance(leftBounds, rightBounds) <= tolerance;
      break;
    case 'non-overlapping':
      passes = boundsDistance(leftBounds, rightBounds) > tolerance;
      break;
    case 'symmetric': {
      const index = axisIndex(axis === 'all' ? 'x' : axis);
      const center = options.symmetryCenter ?? 0;
      passes =
        Math.abs(
          leftBounds.center[index] + rightBounds.center[index] - 2 * center
        ) <= tolerance &&
        [0, 1, 2]
          .filter((candidate) => candidate !== index)
          .every(
            (candidate) =>
              Math.abs(
                leftBounds.center[candidate] - rightBounds.center[candidate]
              ) <= tolerance
          );
      break;
    }
    case 'matched':
      passes =
        distance(left.worldTransform.position, right.worldTransform.position) <=
          tolerance &&
        quaternionAngleDegrees(
          left.worldTransform.quaternion,
          right.worldTransform.quaternion
        ) <=
          (options.rotationToleranceDegrees ??
            DEFAULT_ROTATION_TOLERANCE_DEGREES) &&
        maxTupleDifference(
          left.worldTransform.scale,
          right.worldTransform.scale
        ) <= (options.scaleTolerance ?? DEFAULT_SCALE_TOLERANCE);
      break;
  }
  if (!passes) {
    fail(
      `Expected ${outputLabel(left)} to be ${relation} ${outputLabel(right)}.`
    );
  }
}

export async function expectBoundedResult(
  session: XRBlocksSession,
  options: {
    maxFrames?: number;
    durableFrames?: number;
    description?: string;
    check(snapshot: OutputSnapshot): boolean;
  }
): Promise<void> {
  const maximum = positiveInteger(options.maxFrames ?? 60, 'maxFrames');
  const durable = positiveInteger(options.durableFrames ?? 3, 'durableFrames');
  let consecutive = 0;
  for await (const snapshot of sampleOutputFrames(session, maximum)) {
    consecutive = options.check(snapshot) ? consecutive + 1 : 0;
    if (consecutive >= durable) return;
  }
  fail(
    `${options.description ?? 'Expected output result'} did not remain true for ${durable} frame(s) within ${maximum} frames.`
  );
}

export function expectSpecificText(
  snapshot: OutputSnapshot,
  target: OutputSelector,
  expected: string
): void {
  const output = requireOne(snapshot, target);
  if (output.text !== expected) {
    fail(
      `Expected ${outputLabel(output)} text ${JSON.stringify(expected)}, but received ${JSON.stringify(output.text)}.`
    );
  }
}

export function expectRenderStateChanged(
  before: OutputSnapshot,
  after: OutputSnapshot,
  target: OutputSelector,
  properties?: OutputChangeField[]
): void {
  const [left, right] = requireSharedOutput(before, after, target);
  const changed = changedFields(left, right);
  const renderProperties: OutputChangeField[] = [
    'visibility',
    'color',
    'emissive',
    'opacity',
    'material',
    'geometry',
    'scale',
    'text',
  ];
  if (
    properties === undefined &&
    !changed.some((property) => renderProperties.includes(property))
  ) {
    fail(`${outputLabel(right)} render state did not change.`);
  }
  if (properties === undefined) return;
  const missing = properties.filter((property) => !changed.includes(property));
  if (missing.length > 0) {
    fail(
      `${outputLabel(right)} did not change expected render properties: ${missing.join(', ')}.`
    );
  }
}

export function expectPathConnects(
  snapshot: OutputSnapshot,
  pathTarget: OutputSelector,
  options: {
    start: OutputSelector;
    end: OutputSelector;
    toleranceMeters?: number;
  }
): void {
  const path = requireOne(snapshot, pathTarget);
  if (!path.path) fail(`${outputLabel(path)} has no measurable path.`);
  const start = requireBounds(requireOne(snapshot, options.start));
  const end = requireBounds(requireOne(snapshot, options.end));
  const tolerance = options.toleranceMeters ?? 0.02;
  const forward =
    pointBoundsDistance(path.path.start, start) <= tolerance &&
    pointBoundsDistance(path.path.end, end) <= tolerance;
  const reverse =
    pointBoundsDistance(path.path.start, end) <= tolerance &&
    pointBoundsDistance(path.path.end, start) <= tolerance;
  if (!forward && !reverse) {
    fail(
      `${outputLabel(path)} does not connect ${selectorLabel(options.start)} and ${selectorLabel(options.end)} within ${tolerance} meters.`
    );
  }
}

export function expectSurfaceConformance(
  snapshot: OutputSnapshot,
  target: OutputSelector,
  options: {
    surface?: {id?: string; label?: string};
    maxDistanceMeters?: number;
    maxNormalAngleDegrees?: number;
  } = {}
): void {
  const output = requireOne(snapshot, target);
  const bounds = requireBounds(output);
  const candidates = snapshot.surfaces.filter(
    (surface) =>
      (!options.surface?.id || surface.id === options.surface.id) &&
      (!options.surface?.label || surface.label === options.surface.label)
  );
  if (candidates.length === 0) fail('No matching sensed surface was found.');
  const maximumDistance = options.maxDistanceMeters ?? 0.02;
  const maximumAngle = options.maxNormalAngleDegrees ?? 5;
  const up = rotateVector([0, 1, 0], output.worldTransform.quaternion);
  const samples = [bounds.center, ...boundsCorners(bounds)];
  const match = candidates.find((surface) => {
    const conformingPoint = samples.find(
      (point) =>
        Math.abs(
          toVector3(point)
            .sub(toVector3(surface.position))
            .dot(toVector3(surface.normal))
        ) <= maximumDistance &&
        (!surface.bounds ||
          pointBoundsDistance(point, surface.bounds) <= maximumDistance)
    );
    const normalAngle = vectorAngleDegrees(up, surface.normal);
    return conformingPoint !== undefined && normalAngle <= maximumAngle;
  });
  if (!match) {
    fail(
      `${outputLabel(output)} is not within ${maximumDistance} meters and ${maximumAngle} degrees of a matching sensed surface.`
    );
  }
}

function changedFields(
  before: OutputRecord,
  after: OutputRecord
): OutputChangeField[] {
  const fields: OutputChangeField[] = [];
  if (
    maxTupleDifference(
      before.worldTransform.scale,
      after.worldTransform.scale
    ) > DEFAULT_SCALE_TOLERANCE
  ) {
    fields.push('scale');
  }
  if (before.render.rendered !== after.render.rendered) {
    fields.push('visibility');
  }
  if (materialProperty(before, 'color') !== materialProperty(after, 'color')) {
    fields.push('color');
  }
  if (
    materialProperty(before, 'emissive') !==
      materialProperty(after, 'emissive') ||
    materialProperty(before, 'emissiveIntensity') !==
      materialProperty(after, 'emissiveIntensity')
  ) {
    fields.push('emissive');
  }
  if (
    materialProperty(before, 'opacity') !== materialProperty(after, 'opacity')
  ) {
    fields.push('opacity');
  }
  if (materialState(before) !== materialState(after)) {
    fields.push('material');
  }
  if (
    renderableProperty(before, 'geometry') !==
    renderableProperty(after, 'geometry')
  ) {
    fields.push('geometry');
  }
  if (before.text !== after.text) fields.push('text');
  return fields;
}

function materialProperty(
  output: OutputRecord,
  property: 'color' | 'emissive' | 'emissiveIntensity' | 'opacity'
): string {
  return JSON.stringify(
    output.render.renderables.flatMap((renderable) =>
      renderable.materials.map((material) => material[property])
    )
  );
}

function materialState(output: OutputRecord): string {
  return JSON.stringify(
    output.render.renderables.flatMap((renderable) =>
      renderable.materials.map((material) => ({
        type: material.type,
        visible: material.visible,
        transparent: material.transparent,
        wireframe: material.wireframe,
        side: material.side,
        depthTest: material.depthTest,
        depthWrite: material.depthWrite,
      }))
    )
  );
}

function renderableProperty(
  output: OutputRecord,
  property: 'geometry'
): string {
  return JSON.stringify(
    output.render.renderables.map((renderable) => renderable[property])
  );
}

function outputHasVisibleMaterial(output: OutputRecord): boolean {
  return output.render.renderables.some(
    (renderable) =>
      renderable.hasGeometry &&
      (renderable.materials.length === 0 ||
        renderable.materials.some(
          (material) =>
            material.visible && (!material.transparent || material.opacity > 0)
        ))
  );
}

function requireVisibility(snapshot: OutputSnapshot): void {
  if (!snapshot.visibility.available) {
    fail(
      `Scene Context visibility is unavailable: ${snapshot.visibility.error ?? 'unknown error'}.`
    );
  }
}

function selectOutputs(
  snapshot: OutputSnapshot,
  target: OutputSelector
): OutputRecord[] {
  const selector = normalizeSelector(target);
  return snapshot.outputs.filter((output) => matchesSelector(output, selector));
}

function normalizeSelector(target: OutputSelector): {tag: string; id?: string} {
  const selector = typeof target === 'string' ? {tag: target} : target;
  if (!selector.tag.trim()) throw new TypeError('Output tag cannot be empty.');
  return selector;
}

function matchesSelector(
  output: OutputRecord,
  selector: {tag: string; id?: string}
): boolean {
  return (
    output.tag === selector.tag &&
    (selector.id === undefined || output.id === selector.id)
  );
}

function requireOne(
  snapshot: OutputSnapshot,
  target: OutputSelector
): OutputRecord {
  const matches = selectOutputs(snapshot, target);
  if (matches.length !== 1) {
    fail(
      `Expected one ${selectorLabel(target)} output, but found ${matches.length}.`
    );
  }
  return matches[0];
}

function requireSharedOutput(
  before: OutputSnapshot,
  after: OutputSnapshot,
  target: OutputSelector
): [OutputRecord, OutputRecord] {
  const left = requireOne(before, target);
  const right = after.outputs.find((output) => output.id === left.id);
  if (!right) {
    fail(`${outputLabel(left)} does not exist in the later snapshot.`);
  }
  return [left, right];
}

function requireBounds(output: OutputRecord): OutputBounds {
  if (!output.bounds) fail(`${outputLabel(output)} has no renderable bounds.`);
  return output.bounds;
}

function boundsContains(
  outer: OutputBounds,
  inner: OutputBounds,
  tolerance: number
): boolean {
  return toBox3(outer).expandByScalar(tolerance).containsBox(toBox3(inner));
}

function boundsDistance(left: OutputBounds, right: OutputBounds): number {
  return Math.hypot(
    Math.max(left.min[0] - right.max[0], right.min[0] - left.max[0], 0),
    Math.max(left.min[1] - right.max[1], right.min[1] - left.max[1], 0),
    Math.max(left.min[2] - right.max[2], right.min[2] - left.max[2], 0)
  );
}

function pointBoundsDistance(point: number[], bounds: OutputBounds): number {
  return toBox3(bounds).distanceToPoint(toVector3(point));
}

function boundsCorners(bounds: OutputBounds): number[][] {
  return [
    [bounds.min[0], bounds.min[1], bounds.min[2]],
    [bounds.min[0], bounds.min[1], bounds.max[2]],
    [bounds.min[0], bounds.max[1], bounds.min[2]],
    [bounds.min[0], bounds.max[1], bounds.max[2]],
    [bounds.max[0], bounds.min[1], bounds.min[2]],
    [bounds.max[0], bounds.min[1], bounds.max[2]],
    [bounds.max[0], bounds.max[1], bounds.min[2]],
    [bounds.max[0], bounds.max[1], bounds.max[2]],
  ];
}

function axisIndex(axis: 'x' | 'y' | 'z'): number {
  return {x: 0, y: 1, z: 2}[axis];
}

function distance(left: readonly number[], right: readonly number[]): number {
  return toVector3(left).distanceTo(toVector3(right));
}

function maxTupleDifference(
  left: readonly number[],
  right: readonly number[]
): number {
  return Math.max(
    ...left.map((value, index) => Math.abs(value - right[index]))
  );
}

function quaternionAngleDegrees(
  left: readonly number[],
  right: readonly number[]
): number {
  const leftQuaternion = toQuaternion(left);
  const rightQuaternion = toQuaternion(right);
  if (leftQuaternion.lengthSq() === 0 || rightQuaternion.lengthSq() === 0) {
    return Infinity;
  }
  return (leftQuaternion.angleTo(rightQuaternion) * 180) / Math.PI;
}

function vectorAngleDegrees(
  left: readonly number[],
  right: readonly number[]
): number {
  const leftVector = toVector3(left);
  const rightVector = toVector3(right);
  if (leftVector.lengthSq() === 0 || rightVector.lengthSq() === 0) {
    return Infinity;
  }
  return (leftVector.angleTo(rightVector) * 180) / Math.PI;
}

function rotateVector(
  vector: readonly number[],
  quaternion: readonly number[]
): number[] {
  return toVector3(vector).applyQuaternion(toQuaternion(quaternion)).toArray();
}

function toVector3(values: readonly number[]): Vector3 {
  return new Vector3(values[0], values[1], values[2]);
}

function toQuaternion(values: readonly number[]): Quaternion {
  return new Quaternion(values[0], values[1], values[2], values[3]);
}

function toBox3(bounds: OutputBounds): Box3 {
  return new Box3(toVector3(bounds.min), toVector3(bounds.max));
}

function selectorLabel(target: OutputSelector): string {
  const selector = normalizeSelector(target);
  return selector.id ? `${selector.tag} (${selector.id})` : selector.tag;
}

function outputLabel(output: OutputRecord): string {
  return `${output.tag} (${output.id})`;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

async function* sampleOutputFrames(
  session: XRBlocksSession,
  frames: number
): AsyncGenerator<OutputSnapshot> {
  for (let frame = 0; frame < frames; frame += 1) {
    if (frame > 0) await session.invoke('stepFrame', 1);
    yield captureOutputSnapshot(session);
  }
}

function fail(message: string): never {
  throw new Error(message);
}
