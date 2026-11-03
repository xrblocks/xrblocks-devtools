import {Vector3} from 'three';
import {HAND_JOINT_NAMES} from '../hands/types.js';
import type {PhysicalHand} from '../hands/types.js';

export const HAND_FEATURE_SIZE = HAND_JOINT_NAMES.length * 3;
export type HandPoint = {x: number; y: number; z: number};

export function handFeatures(
  points: readonly HandPoint[],
  hand: PhysicalHand
): Float32Array | null {
  if (
    !['left', 'right'].includes(hand) ||
    points.length !== HAND_JOINT_NAMES.length ||
    points.some(
      (point) => !point || ![point.x, point.y, point.z].every(Number.isFinite)
    )
  )
    return null;
  const wrist = points[0];
  const x = new Vector3().subVectors(points[6], points[21]);
  const size = x.length();
  if (size < 0.005) return null;
  x.divideScalar(size);
  const y = new Vector3().subVectors(points[11], wrist);
  y.addScaledVector(x, -y.dot(x));
  if (y.length() < 0.005) return null;
  y.normalize();
  const z = new Vector3()
    .crossVectors(x, y)
    .multiplyScalar(hand === 'left' ? -1 : 1);
  const result = new Float32Array(HAND_FEATURE_SIZE);
  const offset = new Vector3();
  points.forEach((point, i) => {
    offset.subVectors(point, wrist).divideScalar(size);
    result[i * 3] = offset.dot(x);
    result[i * 3 + 1] = offset.dot(y);
    result[i * 3 + 2] = offset.dot(z);
  });
  return result.every(Number.isFinite) ? result : null;
}
