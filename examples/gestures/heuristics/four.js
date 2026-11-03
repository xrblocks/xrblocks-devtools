import {
  FINGER_ORDER,
  clamp01,
  getFingerStraightness,
  getPalmRight,
  getThumbDirection,
} from 'xrblocks';

export function detectFour(context) {
  const right = getPalmRight(context);
  const thumb = getThumbDirection(context);
  if (!right || !thumb) return undefined;
  const straightness = Math.min(
    ...FINGER_ORDER.map((finger) => getFingerStraightness(context, finger))
  );
  const thumbLateral = Math.abs(thumb.dot(right));
  const fingersExtended = clamp01((straightness - 0.7) / 0.25);
  const thumbAcross = clamp01((0.65 - thumbLateral) / 0.25);
  return {
    confidence: Math.min(fingersExtended, thumbAcross),
    data: {straightness, thumbLateral, fingersExtended, thumbAcross},
  };
}

export const detectors = {four: detectFour};
