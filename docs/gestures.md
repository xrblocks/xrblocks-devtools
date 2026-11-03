# Train hand gesture models

Agents can use the [gesture authoring skill](../skills/author-xrblocks-gestures/SKILL.md)
for pose review, explicit background examples, interpolation, and evaluation.

Train a static hand-shape classifier from the same named poses and sparse joint
rotations used by hand visualization:

```sh
xrblocks-devtools train-gestures examples/gestures/grab-select.json \
  -o artifacts/gestures/grab-select.tflite
```

This writes `grab-select.tflite` and `grab-select.json`. Keep the model and its
manifest together. The command prints generation settings, warnings, sample
counts, and synthetic validation results as JSON. Confusion matrix rows and
columns follow the returned label order; accuracy includes threshold rejection.

Training runs in Node using local hand math, Three.js, and a fixed JS classifier.
It does not start Playwright, download hand meshes, import XR Blocks, or use
`interactive-ml`. Playwright remains the renderer for `visualize hand`.

## Configuration

```json
{
  "seed": 42,
  "samplesPerPose": 250,
  "angleStddevRadians": 0.08,
  "keypointStddevMeters": 0.001,
  "threshold": 0.6,
  "gestures": {
    "grab": [{"pose": "fist"}],
    "select": [
      {"pose": "pinching"},
      {
        "pose": "pinching",
        "rotations": {
          "index-finger-phalanx-proximal": [0.9, 0, 0]
        }
      }
    ],
    "other": [{"pose": "neutral"}, {"pose": "relaxed"}]
  }
}
```

The top-level settings are optional and default to the values above. Each
configuration defaults to `pose: "neutral"` and empty overrides. Rotations use
radians and the visualizer's anatomical XYZ axes. Labels must be unique,
nonempty strings. `other` is a background class suppressed by the runtime adapter.
Include several unrelated background shapes and several configurations per target
gesture where possible.

Generation includes both hands. `samplesPerPose` is the total per configuration
per hand, including one unmodified, anatomically constrained base pose. Finger
flexion combines a shared finger offset and smaller independent joint offsets;
sideways and twist noise are smaller. Fixed axes remain fixed. Angles are sampled
within the simulator's anatomical limits, then forward kinematics computes
keypoints with fixed bone lengths. Gaussian position noise is applied afterward.
Noise settings are standard deviations in radians and meters respectively.

Base configurations are constrained before augmentation. The command warns when
this adjusts a named pose or override. This also affects presets containing small
rotations on axes the constraints fix. Visualization preserves the supplied angles
without constraining them. Large noise can change a gesture's meaning or create
intersections; anatomical bounds alone do not prevent either.

Twenty percent of generated perturbations are reserved for synthetic validation;
the original bases remain in training. This checks interpolation around the
authored poses, not generalization to unseen users. Validate real tracked hands
before relying on the model. Noise and thresholds need tuning for the tracker.

Resource limits: 2–16 classes, 1–32 configurations per class, 2–2000 samples per
configuration per hand, at most 20,000 generated samples, and at most 100,000
samples multiplied by class count. Angle standard deviation is limited to 0.5
radians and position standard deviation to 0.01 meters. Invalid configurations
fail before writing model files. Reusing a seed and settings reproduces the model.

## JavaScript and agents

```js
import {trainGestures} from '@xrblocks/devtools';

const result = await trainGestures({
  config,
  out: './artifacts/gestures.tflite',
  signal: controller.signal,
});
```

The MCP tool `train_gestures` accepts `{config, out}` and returns the same result.
It needs no live Session. Inspect poses with the existing `visualize` tool.

## Interpolate and batch-test poses

`sample_gestures` generates an evenly spaced sequence between two poses by
linearly interpolating their semantic XYZ bone angles in radians. It applies
anatomical limits to the endpoints before interpolation and reports adjustments.
No images or training examples are generated automatically.

```js
import {sampleGestures, testGestureModel, visualize} from '@xrblocks/devtools';

const candidates = sampleGestures({
  from: {label: 'four', rotations: fourRotations},
  to: {label: 'three', rotations: threeRotations},
  steps: 9,
});
const report = await testGestureModel({
  model: './examples/gestures/models/grab-select.tflite',
  poses: candidates.poses,
});
await visualize({
  kind: 'hand',
  rotations: candidates.poses[4].rotations,
  out: './artifacts/midpoint.png',
});
```

Endpoint labels and interpolation position are included in each candidate's
`interpolation` metadata. For unadjusted endpoints with the same label,
intermediates receive a provisional `suggestedLabel` with
`labelSource: "shared-endpoints"`. This is an assumption to review: contact or
finger arrangement can change along the path even when endpoints share a label.
Between different labels, only the unadjusted endpoints carry a suggested label;
intermediates remain unlabeled. There is no automatic halfway label boundary.
Anatomical limits do not prevent every intersection or guarantee gesture meaning.

The MCP tool `test_gesture_model` accepts `{model, poses}`. A single-pose request
uses a one-element array. Each pose accepts `id`, `pose`, `rotations`, and `hand`
(`left`, `right`, or `both`, default `both`). All rotations use radians. Optional
`expected` is an independently reviewed label; `null` or `"other"` means the
model should reject the pose. Suggested interpolation labels are never counted
as expected labels. IDs must be unique within a batch of at most 1,000 poses.

Results contain the input ID, hand, accepted `prediction` (or `null`), `bestMatch`,
its `score`, all class `scores`, and the top-two score `margin`. Low-confidence
and background predictions remain visible in the full scores. Reviewed poses
also return `expected` and `correct`; aggregate accuracy is computed only over
reviewed pose/hand results. Unknown expected labels are rejected.

Batch testing reads the manifest and float32 parameters from the TFLite file;
the companion JSON is unnecessary. It validates the fixed fully-connected and
softmax graph exported by this Devtools version, then evaluates it with the same
JS classifier math used during training. It runs entirely in Node. This is not
a general TFLite interpreter: other graphs, quantization, or unsupported feature
versions are rejected. `check:gestures` verifies decoded parameters and compares
scores against actual LiteRT WASM inference; tiny floating-point differences are
expected.

The same workflow is available through the CLI:

```sh
xrblocks-devtools sample-gestures examples/gestures/interpolate-four-three.json \
  > artifacts/four-three-candidates.json
xrblocks-devtools test-gesture-model examples/gestures/models/grab-select.tflite \
  artifacts/four-three-candidates.json > artifacts/four-three-predictions.json
```

The tester accepts the sampler's output object or a plain array of pose cases.
Inspect useful candidates with `visualize`, assign reviewed expected labels,
and keep independently authored evaluation cases separate from training. A
low score on an unlabeled intermediate is a review candidate, not a proven error.

## Use in XR Blocks

Install `@litertjs/core` in the consuming app and serve its `wasm` directory.
Use a bundler or an import map to resolve the browser-safe adapter entry point:

```js
import {loadLiteRt} from '@litertjs/core';
import {TFLiteGestureRecognizer} from '@xrblocks/devtools/gestures';

await loadLiteRt('/vendor/litert/wasm/');
const recognizer = await TFLiteGestureRecognizer.load(
  '/models/grab-select.tflite',
  '/models/grab-select.json'
);
options.gestures.setGestureRecognizer(recognizer);
options.gestures.enableGestures();
```

The adapter implements the existing `GestureRecognizer` interface. It reads all
25 world-space joint positions from `HandContext`, normalizes them, and runs the
model on LiteRT's WASM CPU backend. It returns only the winning gesture, provided
its score reaches the threshold and its label is not `other`. Missing, non-finite,
or degenerate tracking produces no gesture. Scores are softmax scores rather than
calibrated probabilities; unknown poses can still receive high scores.

Calls are serialized because one recognizer can serve both hands. Dispose the
recognizer when replacing it; disposal waits for pending inference. No XR Blocks
core changes or `interactive-ml` imports are required.

## Model contract

The manifest defines `format: "xrblocks-hand-gestures"`, version `1`, feature
schema `palm-local-xyz-v1`, ordered joint names and labels, and the threshold. The
same manifest is embedded as custom `xrblocks-hand-gestures` TFLite metadata.

| Tensor     | Type and shape                            |
| ---------- | ----------------------------------------- |
| `features` | float32 `[1, 75]`                         |
| `scores`   | float32 `[1, C]`, in manifest label order |

The `serving_default` signature exposes these tensors. The graph uses the standard
TFLite fully connected and softmax operations. Training standardization is folded
into the exported weights and bias. Palm feature extraction and thresholding live
outside the graph.

The browser entry exports `handFeatures(points, hand)` for other runtimes. Points
must be `{x, y, z}` objects in manifest joint order. Coordinates are translated by
the wrist, divided by proximal index-to-pinky palm width, and projected onto
anatomical palm axes with handedness correction. The wrist contributes three
zeros. Global rotation, position, and uniform scale are removed. Consequently,
this model does not distinguish shapes by world orientation, such as thumbs-up
versus thumbs-down, or recognize motion sequences.

## Verification and source

Run `npm run check:gestures` for an assert-based end-to-end check. It checks
validation, cancellation, determinism, coordinate invariance, JS/TFLite agreement,
the runtime adapter, and actual mesh previews. Artifacts are saved under
`artifacts/gesture-check/`. Chromium must be installed for the inference and
preview checks; training itself requires no browser.

Hand skeleton calibration, named poses, anatomical constraints, and forward
kinematics were adapted from the Apache-2.0 licensed
[XR Blocks simulator](https://github.com/google/xrblocks/tree/1a3762a604a9c3e76bc8a4ab379e0608266e42d2/src/simulator/handPoses).
Devtools owns this copy. The export writer follows the
[TensorFlow Lite v3 schema](https://github.com/tensorflow/tensorflow/blob/v2.20.0/tensorflow/compiler/mlir/lite/schema/schema.fbs).
