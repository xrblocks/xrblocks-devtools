# Heuristic detector authoring

Deliver a JavaScript module exporting `detectors`, labeled pose cases, and a
batch report. Use public XR Blocks metric helpers and the existing
`HeuristicGestureDetector(context, config)` contract. Avoid a custom rule language
or translating an ML prediction into a heuristic's expected labels.

## Inspect before choosing thresholds

Use `inspect_hand_poses({poses})` on representative positives and negatives.
Each pose accepts `id`, `pose`, `rotations`, and `hand` (default `both`), just like
the existing pose tools. Rotations are radians. Inspection returns SDK finger
straightness, curl and bend cosines, thumb opposition, finger spread, fingertip
distances in meters and palm widths, and world palm axes.

Use the metrics that separate the intended cases. Normalize distances by SDK
palm width. Decide explicitly whether world orientation is meaningful; a
palm-relative dot product is rotation invariant, while a world Y component is not.
Do not equate the SDK's metacarpal palm width with the ML feature extractor's
proximal-joint palm width.

## Write ordinary SDK functions

```js
import {getFingertipDistance, getPalmWidth, clamp01} from 'xrblocks';

export function detectPinch(context) {
  const distance = getFingertipDistance(context, 'thumb', 'index');
  const width = getPalmWidth(context);
  if (distance === null || !width || width < 1e-6) return undefined;
  const normalizedDistance = distance / width;
  return {
    confidence: clamp01((0.7 - normalizedDistance) / 0.4),
    data: {normalizedDistance},
  };
}

export const detectors = {pinch: detectPinch};
```

This illustrates the module contract, not tuned universal pinch thresholds.
Require every defining condition; a weighted average can let a strong unrelated
condition compensate for a missing required finger shape. Smooth score ranges
help inspect boundaries. Return finite `[0, 1]` confidence scores and intermediate
measurements in a JSON `data` object. Return `undefined` when required tracking
cannot be measured. Keep functions synchronous and stateless; do not mutate the
context. The same functions register directly with
`HeuristicGestureRecognizer.registerGesture(name, detector)` in an app.

## Evaluate exact accepted sets

Call `test_gesture_detector({input: {path: './detectors.js'}, poses})`.
Inline `{source}` also works; use file input for relative imports. Both heuristic
tools require the installed XR Blocks SDK and Playwright Chromium, but no live
Session, rendering, or mesh download. `xrblocksRoot` can select a built SDK checkout.
The tester executes trusted module code in a temporary browser that it closes.

Use independent expected labels: a string requires that one detector, an array
requires that exact set, and `null` requires no accepted detectors. Omit
expectations on unresolved samples. There is no `other` detector. The default
acceptance cutoff is `minimumConfidence: 0.6`; per-detector
`configurations: {name: {enabled, threshold?}}` supply SDK detector parameters.

Inspect all accepted names, confidence scores, diagnostic data, overlaps, false
positives, and misses. A null score means the detector returned `undefined`.
Overlapping detections can be intentional, but unexpected extra labels fail an
exact-set check. Do not hide overlaps by taking an argmax.

Add `augmentation: {samplesPerPose: 25, seed: 42}` to check noisy variants.
Defaults are 0.08 radians angular and 0.001 meters keypoint standard deviation;
overrides use `angleStddevRadians` and `keypointStddevMeters`. Counts are per hand
and include the base. Without augmentation, authored angles are preserved; with
augmentation, review anatomical constraint warnings before trusting the labels.
Preserve the ordered source poses, settings, seed, and sample indices to reproduce
a report. Inspect `data` on failures rather than moving cutoffs blindly.

Reuse `sample_gestures` for reviewed boundary candidates and `visualize` for
shape inspection. Same-label interpolation remains provisional. Extend the
regression bank with missed positives and unwanted detections; keep independent
validation separate from cases used to choose thresholds. Real tracking needs
separate checks, especially occlusion and stability near boundaries.

CLI equivalents:

```sh
npx --no-install xrblocks-devtools inspect-hand-poses poses.json
npx --no-install xrblocks-devtools test-gesture-detector detectors.js poses.json
```

JSON can be a pose array or a request options object without `input`. Report the
tested vocabulary, cutoffs, noisy sample counts, overlaps, remaining failures, and
what real-hand validation was performed. No model training or export is needed.
