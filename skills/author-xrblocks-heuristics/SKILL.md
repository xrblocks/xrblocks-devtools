---
name: author-xrblocks-heuristics
description: Author and improve JavaScript hand gesture heuristics for XR Blocks by identifying defining pose characteristics, inspecting SDK measurements, and evaluating positives, negatives, noisy variants, and overlapping detections with xrblocks-devtools. Use for transparent geometric detectors rather than trained gesture models.
---

# Author XR Blocks heuristic gestures

Deliver ordinary SDK detector functions, reviewed pose cases, and a batch report.
Use `inspect_hand_poses`, `test_gesture_detector`, `sample_gestures`, and `visualize`.
Read [references/tools.md](references/tools.md) for the module contract, tool
arguments, units, SDK requirements, and CLI equivalents. No training or TFLite
export is involved.

## Identify what defines each pose

Inspect the supplied configurations and render unfamiliar or ambiguous shapes.
Describe each target in terms of finger identities, required extension or curl,
thumb position, contact, spread, and meaningful orientation. Separate defining
requirements from incidental variations that should remain valid.

Use the requested gesture meaning rather than copying every detail of a seed:

| Shape | Candidate defining characteristics                                  | Useful nearby negatives                            |
| ----- | ------------------------------------------------------------------- | -------------------------------------------------- |
| Four  | Four long fingers extended; thumb across the palm                   | Open palm with thumb splayed, three, pinch         |
| Peace | Index/middle extended; ring/pinky curled; spread if a V is required | Point, three, loosely open palm                    |
| Shaka | Thumb/pinky extended; index/middle/ring curled                      | Thumb-only, pinky-only, fist, index/pinky extended |
| Pinch | Thumb/index tips close relative to palm size                        | Near-pinch without contact, fist, point            |

These are starting hypotheses, not universal definitions. For example, other
fingers may vary freely during pinch unless the user explicitly constrains them.
World-facing direction matters only when it is part of the requested gesture.

For every label, record the required conditions, allowed variations, and the
closest unwanted shapes. Author positives and negatives before tuning. Use
`expected: null` when nothing should match, not an `other` detector. Use an
expected label array when simultaneous detections are intentional.

## Find measurements that distinguish the cases

Batch-inspect both hands. Compare relevant metrics across positives and nearby
negatives: per-finger straightness/curl, thumb opposition, palm-relative direction,
spread, and normalized contact distances. Do not rely on averages that can hide
one incorrectly posed finger.

Record which measurement and range support each defining condition. Choose
thresholds from those observations with room for valid variation. If a positive
and a negative share one metric, find another meaningful distinction rather than
adding arbitrary special cases. Report unresolved ambiguity when the available
measurements do not separate the intended meanings.

Prefer palm-relative vectors and distances divided by SDK palm width for shape
rules. Use world axes explicitly for direction-dependent gestures. Keep the
distinction between cosine bend measurements, normalized scores, and meter
distances clear; authoring joint rotations are radians.

## Write a small, explainable detector

Export synchronous `(context, config) => {confidence, data}` functions using
public XR Blocks helpers. Use smooth score ranges around observed boundaries.
Combine required conditions with `Math.min` or explicit gates; use `Math.max`
for reviewed alternative valid forms. Add weights only when their meaning is
clear. Confidence is a rule score, not a calibrated probability.

Return the measurements and condition scores in `data`, using names that explain
why a pose passes or fails. Return `undefined` for unavailable required tracking.
Keep detectors stateless and avoid modifying the context. The functions must
register directly with `HeuristicGestureRecognizer.registerGesture`.

## Check boundaries and refine

Run `test_gesture_detector` on the reviewed bank and inspect diagnostic data on
every failure. Check missed positives, unwanted detections, and competing labels.
The tester returns all accepted gestures; do not hide overlap by taking an argmax.

Use `sample_gestures` to explore transitions toward the closest negative and
between alternative valid forms. Inspect useful candidates before assigning
expectations; interpolation suggestions and current detector outputs are not
ground truth. Preserve discovered failures as regression cases.

Add seeded angular/keypoint augmentation after the base cases are understood.
Review anatomical constraint warnings and confirm that perturbations still mean
the same gesture. Keep cases and generation settings fixed when comparing rule
changes. Change the failed condition, then recheck the full vocabulary so fixing
one pose does not silently introduce another detection.

Stop when the requested cases pass or remaining limits are explicit. Deliver the
JS module, expected pose bank, settings, and report with false positives, misses,
and overlaps. Distinguish cases used to choose thresholds from independent
validation. Real tracked hands and temporal stability need separate checks.
