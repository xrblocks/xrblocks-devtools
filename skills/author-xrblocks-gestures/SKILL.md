---
name: author-xrblocks-gestures
description: Author and improve static XR Blocks hand gesture TFLite models using explicit joint poses, background examples, reviewed interpolation, synthetic training, and batch evaluation with xrblocks-devtools. Use when creating gesture datasets or investigating missed gestures and false detections.
---

# Author XR Blocks gestures

Produce a training configuration, a `.tflite` model with its companion JSON
manifest, and a labeled evaluation bank with a prediction report. Reuse existing
datasets and tools. Training and batch testing run in Node without a browser or
`interactive-ml`; hand visualization still uses Playwright and cached hand meshes.

## Define the shapes and rejection cases

Describe which finger curls, spread, thumb positions, and contacts define each
label, and which variations should retain it. This classifier recognizes static
shapes: both feature formats remove world position, rotation, and uniform scale.
It cannot distinguish thumbs-up from thumbs-down by orientation or recognize
motion sequences.

Store training poses in `gestures.<label>` arrays. Each entry accepts
`{pose?, rotations?}`; `pose` defaults to `neutral`. `rotations` maps simulator
joint names to anatomical XYZ Euler angles in **radians**. Use named poses as
starting points when useful, then author explicit rotations for the intended
shapes. Discover joint names and presets through `@xrblocks/devtools/hands`
exports `HAND_POSE_JOINT_NAMES` and `HAND_POSES`.

Include a `gestures.other` array for shapes that should return nothing. Use
neutral plus varied task-specific negatives: partial curls, broken contacts,
nearby unwanted finger arrangements, and transitions that belong to no target.
A shape may be a negative only if the requested vocabulary excludes it. Neutral
alone does not describe every unwanted pose. `other` receives the same
augmentation as positive labels; the runtime suppresses it when it wins.

Before fitting, author evaluation cases with unique IDs, pose data, and reviewed
`expected` labels. Use `expected: null` for rejection; `"other"` is equivalent.
For example, this is a labeled negative case, not a training configuration:

```json
{
  "id": "neutral-background",
  "pose": "neutral",
  "hand": "both",
  "expected": null
}
```

Keep evaluation cases separate from training. Once a failure guides example
selection, retain it as a development regression and report that use. Reserve
independent poses or real captures for claims about generalization. Labels come
from the intended shape and inspection, never from the model's prediction.

## Inspect and expand examples

Use MCP `visualize` with
`{request: {kind: "hand", rotations, hand: "both"}, out}` to render an explicit
pose, then open the PNG. Review finger identity, curl, thumb placement, and
contact from suitable views. Render meaningful new endpoints and questionable
intermediates; anatomy limits do not guarantee valid contact or prevent collisions.
Hand visualization CLI `--joint` angles are **degrees**, unlike JSON/API radians.

Use `sample_gestures({from, to, steps})` to interpolate semantic bone angles.
Each endpoint accepts `{pose?, rotations?, label?}`. A short path, such as five
steps, is a useful candidate set; it is not automatically training data.

- Same-label intermediates have provisional `suggestedLabel` values. Review
  that the defining contact and finger arrangement survive the path.
- Cross-label intermediates remain unlabeled. Review each useful candidate as
  one target, `other`, or unresolved; there is no automatic halfway boundary.
- Endpoint constraint warnings require review before trusting label suggestions.

Only copy reviewed `{pose, rotations}` into training arrays. Sampler IDs,
`interpolation` metadata, `hand`, and `expected` are not training-pose fields.
For pinch variants, vary remaining fingers while retaining thumb/index contact.
Prefer examples covering a missing variation over more perturbations of one pose.

## Train a small candidate

Use MCP `train_gestures({config, out})`, with `out` ending in `.tflite`.
The configuration contains `gestures` and optional generation settings.
Choose `features: "palm-local-xyz-v1"` (default) for 75 palm-normalized joint
coordinates, or `features: "relative-bone-angles-v1"` for the 14 bend cosines
returned by XR Blocks' `getRelativeBoneAngles`. Palm coordinates retain finger
spread and fingertip placement but depend on bone proportions. Bone angles remove
individual lengths but omit contact distances and between-finger spread. Keep the
same poses and settings when comparing formats; judge them on the task's cases.
Authoring rotations remain radians in both modes. The model manifest controls
feature selection automatically during batch testing and runtime inference.
For a small first run, explicitly set `samplesPerPose: 75`; the tool default is 250. Total samples are `2 × samplesPerPose × number of configurations`, including
`other` and both hands. Forty configurations at 75 produce 6,000 samples.

Start with `seed: 42`, `angleStddevRadians: 0.08`,
`keypointStddevMeters: 0.001`, and `threshold: 0.6` unless the task needs different
values. The threshold matches XR Blocks' default minimum confidence. It applies
to softmax scores, which are not calibrated probabilities.

Generation uses bounded, correlated finger curl noise and smaller independent
joint offsets, followed by keypoint position noise. Inspect constraint warnings;
the trainer constrains bases while the visualizer preserves supplied rotations.
Large perturbations can change the gesture despite anatomical bounds. About 20%
of generated perturbations form synthetic validation around the same authored
families; bases remain in training. This is not independent recognition accuracy.

## Batch-check and iterate

Call `test_gesture_model({model, poses})` with the exported local model path and
an array of cases. Omitted `hand` means both hands. It accepts sampler candidates
directly, but only independently assigned `expected` values count as evaluation.
Inspect `prediction`, `bestMatch`, all `scores`, top-two `margin`, and per-case
`correct`; `prediction: null` means background or below-threshold rejection.
The tester supports this Devtools export graph, not arbitrary TFLite models.

Check valid variations, neighboring labels, and negatives. A low score on an
unlabeled interpolation is a review candidate, not a proven failure. Add reviewed
positive variants for misses and explicit `other` variants for false detections.
Recheck existing cases after each candidate; do not relabel them to match output.
Keep seeds and settings fixed when comparing dataset changes. Lowering the
threshold can recover valid poses and admit false detections, so evaluate both.

Stop when the requested cases pass or remaining failures are clear. Report
sample counts, settings, rejection and confusion cases, before/after development
results, and what independent data was checked. Do not keep expanding a dataset
just to inflate a score.

## CLI and delivery

The same tools are available without MCP:

```sh
npx --no-install xrblocks-devtools sample-gestures endpoints.json > candidates.json
npx --no-install xrblocks-devtools train-gestures training.json -o artifacts/gestures.tflite
npx --no-install xrblocks-devtools test-gesture-model artifacts/gestures.tflite evaluation.json > predictions.json
```

`endpoints.json` contains `{from, to, steps}`. `evaluation.json` is a plain array
of cases or an object with a `poses` array. Keep the exported `.tflite` and its
companion `.json` manifest together when delivering to an app. The batch tester
needs only the `.tflite`, whose metadata embeds the manifest. Include the source
configuration, reviewed cases, and report so another agent can reproduce the work.

When updating the existing XR Blocks `demos/sim_hand_poses` example, copy the
model and manifest into its `models/` directory and the training configuration
as `grab-select.poses.json`. Reload **Load grab / select example** to replace an
already loaded model. For another model, use **Load model + manifest**. Check
representative poses in the demo and report real-hand validation separately.
