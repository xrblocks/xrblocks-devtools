# Author heuristic hand gestures

Agents can use the [heuristic authoring skill](../skills/author-xrblocks-heuristics/SKILL.md)
to identify defining pose characteristics and turn measured distinctions into
explainable rules.

Use the same explicit poses, labeled negative cases, and reviewed interpolations
as the TFLite workflow, while delivering ordinary JavaScript detector functions.
The authoring loop is **inspect measurements → write a detector → batch-check →
adjust**. No training or model export is needed.

Both tools use the installed XR Blocks SDK in a temporary Playwright browser.
They call the actual public SDK helpers, without copying metric formulas or
requiring a live XR Session, WebGL rendering, or hand meshes. Install the optional
`xrblocks` peer and Playwright Chromium. An optional `xrblocksRoot` selects a
local SDK checkout with `build/xrblocks.js`.

## Inspect poses

```js
import {inspectHandPoses} from '@xrblocks/devtools';

const report = await inspectHandPoses({
  poses: [{id: 'open', pose: 'neutral', hand: 'both'}],
});
```

MCP `inspect_hand_poses` accepts the same object. Each result has the pose ID,
hand, and named `metrics`:

- `palm`: width in meters, center, and world normal/right/up vectors.
- `fingers`: bend cosines, straightness, curl, direction, palm alignment, and
  fingertip-to-palm distance in meters and palm widths for each long finger.
- `thumb`: bend cosines, straightness, curl, direction, vertical direction,
  and opposition to each finger.
- `adjacentSpreads`: index/middle, middle/ring, and ring/pinky separation scores.
- `fingertipDistances`: all ten tip pairs, in meters and palm widths.

These names describe SDK measurements, not calibrated probabilities. SDK palm
width uses the index and pinky metacarpal joints; the ML palm feature scale uses
their proximal joints. Inspection preserves supplied rotations, matching hand
visualization. Angles in pose JSON are radians; bend measurements are cosines.

## Write an SDK detector module

Export a `detectors` object mapping names to synchronous SDK
`HeuristicGestureDetector` functions. Each receives `(context, config)` and returns
`undefined` or `{confidence, data?}`. Confidence must be finite and in `[0, 1]`.
Optional `data` is a JSON diagnostic object under 64 KB; return useful intermediate
measurements and gates so an agent can explain a miss or false positive.
Diagnostic data across a batch is limited to 8 MB.

The runnable example is
[`four.js`](../examples/gestures/heuristics/four.js). It requires all four long
fingers to be straight and the thumb to point across the palm. It uses smooth
score ranges and the weakest required condition, with palm-relative thumb
direction so global rotation does not define the gesture.

Use the same exported functions directly in XR Blocks:

```js
import {HeuristicGestureRecognizer} from 'xrblocks';
import {detectors} from './four.js';

const recognizer = new HeuristicGestureRecognizer(false);
for (const [name, detector] of Object.entries(detectors)) {
  recognizer.registerGesture(name, detector);
}
options.gestures.setGestureRecognizer(recognizer);
options.gestures.enabled = true;
```

Keep detectors stateless and avoid mutating `context`. The test runner supports
JS/TS file modules with relative imports, or inline source with public `xrblocks`
imports. It executes the supplied module as browser JavaScript; use trusted code.
Calls time out after 30 seconds of browser evaluation and close their browser,
server, and temporary files on success, error, cancellation, or timeout.

## Evaluate cases and overlaps

```js
import {testGestureDetector} from '@xrblocks/devtools';

const report = await testGestureDetector({
  input: {path: './four.js'},
  minimumConfidence: 0.6,
  poses: [{id: 'negative', pose: 'neutral', expected: null}],
});
```

MCP `test_gesture_detector` takes the same object. `input` accepts either `{path}`
or `{source}`. `configurations` optionally maps detector names to
`{enabled, threshold?}`, matching the SDK configuration. These are detector
parameters; `minimumConfidence` is the separate acceptance cutoff, default 0.6.

Poses accept `id`, `pose`, sparse `rotations`, and `hand` (`both` by default),
including `interpolation` metadata from `sample_gestures`. Give independently
reviewed `expected` values:

- A label means exactly that detector should be accepted.
- An array means that exact set should be accepted; multiple matches may be intentional.
- `null`, `"other"`, or `[]` means no detector should be accepted. There is no
  `other` detector.
- Omitted expectations produce scores without counting toward accuracy.

Results include `accepted` (all accepted names), every enabled detector's
`scores` with confidence and diagnostics, `overlap`, and, for labeled cases,
`correct`, `falsePositives`, and `missed`. A `null` score means the detector
returned `undefined`, so it is rejected even with a zero cutoff. Unknown labels,
invalid outputs, and detector exceptions fail the call with actionable errors.

The report counts overlapping hand samples separately from correctness. Aggregate
false positives and misses count extra and missing labels respectively. It never
chooses a single winner to hide competing detections. A multi-match case is
correct only if the expected set matches exactly.

## Check noisy variants

Add `augmentation: {samplesPerPose: 25, seed: 42}` to evaluate perturbations with
the same articulation and keypoint noise as training. The object defaults angular
standard deviation to 0.08 radians and keypoint standard deviation to 0.001 meters.
Both can be overridden. `samplesPerPose` is per hand and includes one unchanged
base; all generated samples are evaluated, without a training/validation split.

Without augmentation, each supplied pose is evaluated once per requested hand.
With augmentation, bases are anatomically constrained and adjustments are reported
as warnings; review affected expected labels. Seeded results are reproducible for
the same ordered inputs and settings. Large noise may change the gesture meaning.
Limits are 1,000 source poses, 2–200 samples per pose per hand when augmented, and
20,000 evaluated hand samples overall. IDs must be unique among source poses;
`sample` distinguishes generated variants.

## CLI and example

```sh
npm run build
node dist/cli.js inspect-hand-poses examples/gestures/heuristics/poses.json
node dist/cli.js test-gesture-detector examples/gestures/heuristics/four.js \
  examples/gestures/heuristics/poses.json
```

The JSON input can be a plain pose array or the request options object without
`input`. Use the latter to set augmentation, configurations, cutoff, or SDK root.
Commands print reports as JSON. JavaScript calls also accept an optional second
`AbortSignal` argument.

Use `sample_gestures` and `visualize` to review boundaries, keeping interpolated
label suggestions provisional. Start with poses whose expected meaning is clear,
then preserve failures as regressions. Keep development cases and independent
validation separate. The example's thresholds were chosen using the existing
development bank; synthetic results do not establish real-hand performance.

Run `npm run check:heuristics` for the assert-based integration check, including
real SDK imports, metrics, noisy variants, overlaps, diagnostics, errors, and
temporary runtime cleanup. Existing TFLite checks remain `npm run check:gestures`.
