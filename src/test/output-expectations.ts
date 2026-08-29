import {Box3, Plane, Quaternion, Vector3} from 'three';

import type {XRBlocksSession} from '../session/index.js';
import type {
  OutputBounds,
  OutputChangeField,
  OutputRecord,
  OutputSelector,
  OutputSnapshot,
} from './output-types.js';

const DEFAULT_POSITION_TOLERANCE_METERS = 0.001;
const DEFAULT_ROTATION_TOLERANCE_DEGREES = 0.1;
const DEFAULT_SCALE_TOLERANCE = 0.001;

type OutputVisibilityResult = {
  exists: boolean;
  visible: boolean;
};

export async function captureOutputSnapshot(
  session: XRBlocksSession,
  options: {tags?: string[]} = {}
): Promise<OutputSnapshot> {
  return session.invoke<OutputSnapshot>('captureOutputSnapshot', options);
}

export async function expectVisible(
  session: XRBlocksSession,
  target: OutputSelector
): Promise<void> {
  const result = await inspectVisibility(session, target);
  if (result.visible) return;

  if (!result.exists) {
    fail(`${selectorLabel(target)} does not exist.`);
  }
  fail(`${selectorLabel(target)} has no displayed geometry.`);
}

export async function expectNotVisible(
  session: XRBlocksSession,
  target: OutputSelector
): Promise<void> {
  const result = await inspectVisibility(session, target);
  if (!result.visible) return;
  fail(`${selectorLabel(target)} is visible to the user.`);
}

export function expectTransformChanged(
  before: OutputSnapshot,
  after: OutputSnapshot,
  target: OutputSelector,
  options: {
    positionMeters?: number;
    rotationDegrees?: number;
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

export type SpatialRelation = 'aligned' | 'above' | 'touching';

export function expectSpatialRelation(
  snapshot: OutputSnapshot,
  leftTarget: OutputSelector,
  relation: SpatialRelation,
  rightTarget: OutputSelector,
  options: {
    toleranceMeters?: number;
    axis?: 'x' | 'y' | 'z' | 'all';
  } = {}
): void {
  const left = requireOne(snapshot, leftTarget);
  const right = requireOne(snapshot, rightTarget);
  const tolerance = options.toleranceMeters ?? 0.01;
  const leftBounds = requireBounds(left);
  const rightBounds = requireBounds(right);
  let passes = false;

  switch (relation) {
    case 'aligned': {
      const axis = options.axis ?? 'all';
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
    case 'touching':
      passes = boundsDistance(leftBounds, rightBounds) <= tolerance;
      break;
  }

  if (!passes) {
    fail(
      `Expected ${outputLabel(left)} to be ${relation} ${outputLabel(right)}.`
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
  if (properties === undefined && changed.length === 0) {
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

export function expectOnSurface(
  snapshot: OutputSnapshot,
  target: OutputSelector,
  options: {
    surface?: {id?: string; kind?: 'plane' | 'mesh'; label?: string};
    toleranceMeters?: number;
  } = {}
): void {
  const output = requireOne(snapshot, target);
  const bounds = requireBounds(output);
  const candidates = snapshot.surfaces.filter(
    (surface) =>
      (!options.surface?.id || surface.id === options.surface.id) &&
      (!options.surface?.kind || surface.kind === options.surface.kind) &&
      (!options.surface?.label || surface.label === options.surface.label)
  );
  if (candidates.length === 0) fail('No matching sensed surface was found.');

  const tolerance = options.toleranceMeters ?? 0.02;
  const matches = candidates.some((surface) => {
    if (surface.kind === 'mesh') {
      return (surface.distanceByOutputId?.[output.id] ?? Infinity) <= tolerance;
    }
    if (!surface.normal) return false;
    const normal = toVector3(surface.normal);
    if (normal.lengthSq() === 0) return false;
    const expandedBounds = toBox3(bounds).expandByScalar(tolerance);
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      normal.normalize(),
      toVector3(surface.position)
    );
    return (
      expandedBounds.intersectsPlane(plane) &&
      (!surface.bounds || expandedBounds.intersectsBox(toBox3(surface.bounds)))
    );
  });
  if (!matches) {
    fail(
      `${outputLabel(output)} is not within ${tolerance} meters of a matching sensed surface.`
    );
  }
}

async function inspectVisibility(
  session: XRBlocksSession,
  target: OutputSelector
): Promise<OutputVisibilityResult> {
  return session.invoke<OutputVisibilityResult>(
    'inspectOutputVisibility',
    normalizeSelector(target)
  );
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
  if (before.render.displayed !== after.render.displayed) {
    fields.push('visibility');
  }
  if (colorState(before) !== colorState(after)) {
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
  if (geometryState(before) !== geometryState(after)) {
    fields.push('geometry');
  }
  if (before.text !== after.text) fields.push('text');
  return fields;
}

function colorState(output: OutputRecord): string {
  return JSON.stringify(
    output.render.renderables.map((renderable) => ({
      materials: renderable.materials.map((material) => material.color),
      vertexColors: renderable.vertexColors,
    }))
  );
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

function geometryState(output: OutputRecord): string {
  return JSON.stringify(
    output.render.renderables.map((renderable) => renderable.geometry)
  );
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

function boundsDistance(left: OutputBounds, right: OutputBounds): number {
  return Math.hypot(
    Math.max(left.min[0] - right.max[0], right.min[0] - left.max[0], 0),
    Math.max(left.min[1] - right.max[1], right.min[1] - left.max[1], 0),
    Math.max(left.min[2] - right.max[2], right.min[2] - left.max[2], 0)
  );
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

function fail(message: string): never {
  throw new Error(message);
}
