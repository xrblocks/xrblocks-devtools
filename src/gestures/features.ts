import {Vector3} from 'three';
import {HAND_JOINT_NAMES} from '../hands/types.js';
import type {PhysicalHand} from '../hands/types.js';

export const HAND_FEATURE_SIZES = {
  'palm-local-xyz-v1': HAND_JOINT_NAMES.length * 3,
  'relative-bone-angles-v1': 14,
} as const;
export type HandFeatureFormat = keyof typeof HAND_FEATURE_SIZES;
export type HandPoint = {x: number; y: number; z: number};

const bones = [
  [1, 2],
  [2, 3],
  [3, 4],
  [5, 6],
  [6, 7],
  [7, 8],
  [8, 9],
  [10, 11],
  [11, 12],
  [12, 13],
  [13, 14],
  [15, 16],
  [16, 17],
  [17, 18],
  [18, 19],
  [20, 21],
  [21, 22],
  [22, 23],
  [23, 24],
];
const bonePairs = [
  [0, 1],
  [1, 2],
  [3, 4],
  [4, 5],
  [5, 6],
  [7, 8],
  [8, 9],
  [9, 10],
  [11, 12],
  [12, 13],
  [13, 14],
  [15, 16],
  [16, 17],
  [17, 18],
];

export function handFeatures(
  points: readonly HandPoint[],
  hand: PhysicalHand,
  format: HandFeatureFormat = 'palm-local-xyz-v1'
): Float32Array | null {
  if (
    !['left', 'right'].includes(hand) ||
    points.length !== HAND_JOINT_NAMES.length ||
    points.some(
      (point) => !point || ![point.x, point.y, point.z].every(Number.isFinite)
    )
  )
    return null;
  if (format === 'relative-bone-angles-v1') {
    const vectors = bones.map(([start, end]) =>
      new Vector3().subVectors(points[end], points[start]).normalize()
    );
    if (vectors.some((vector) => vector.lengthSq() === 0)) return null;
    const result = Float32Array.from(bonePairs, ([a, b]) =>
      vectors[a].dot(vectors[b])
    );
    return result.every(Number.isFinite) ? result : null;
  }
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
  const result = new Float32Array(HAND_FEATURE_SIZES[format]);
  const offset = new Vector3();
  points.forEach((point, i) => {
    offset.subVectors(point, wrist).divideScalar(size);
    result[i * 3] = offset.dot(x);
    result[i * 3 + 1] = offset.dot(y);
    result[i * 3 + 2] = offset.dot(z);
  });
  return result.every(Number.isFinite) ? result : null;
}
