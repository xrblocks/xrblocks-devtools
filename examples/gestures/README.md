# Grab / select gesture model

`grab-select.json` contains explicit joint rotations in radians, with no named
pose presets. The 40 configurations vary finger curl, spread, and thumb position:

| Label    | Configurations | Shape                                                        |
| -------- | -------------- | ------------------------------------------------------------ |
| `grab`   | 4              | Closed fist                                                  |
| `select` | 6              | Thumb/index pinch with different remaining-finger curls      |
| `point`  | 4              | Index extended, other fingers curled                         |
| `peace`  | 4              | Index and middle extended and separated                      |
| `shaka`  | 4              | Thumb and pinky extended; middle three fingers curled        |
| `three`  | 4              | Index, middle, and ring extended; thumb and pinky folded     |
| `four`   | 10             | Four fingers extended; thumb folded                          |
| `other`  | 4              | Open palms, loosely curled fingers, and index/pinky extended |

Shaka, three, and four are not XR Blocks named presets.

Every configuration specifies all 20 non-tip joint rotations. Unspecified-pose
training configurations start from neutral. Both hands are generated with angle
and keypoint noise: 40 configurations × 75 samples × 2 hands = 6,000 samples
(4,800 training, 1,200 synthetic validation). Generation, training, validation,
and export took about 8–15 seconds on the development machine, depending on
concurrent rendering work.

Additional examples include reviewed interpolations between poses of the same
gesture. Pinch examples retain thumb/index contact while varying the other
fingers. Noise remains 0.08 radians angular standard deviation and 0.001 meters
keypoint standard deviation; acceptance is 60%, matching XR Blocks' default
minimum confidence.

```sh
npm run build
node dist/cli.js train-gestures examples/gestures/grab-select.json \
  -o examples/gestures/models/grab-select.tflite
```

The generated model and companion label/feature manifest are in `models/`.
`grab-select.tflite` uses `palm-local-xyz-v1`, the default. The additional
`grab-select-bone-angles.tflite` uses `relative-bone-angles-v1` with the same
authored poses, 6,000 samples, augmentations, seed, and 60% threshold. Its
companion manifest is `grab-select-bone-angles.json`. Reproduce it with:

```sh
node --input-type=module <<'EOF'
import {readFile} from 'node:fs/promises';
import {trainGestures} from './dist/gestures/train.js';
const config = JSON.parse(await readFile('examples/gestures/grab-select.json', 'utf8'));
await trainGestures({
  config: {...config, features: 'relative-bone-angles-v1'},
  out: 'examples/gestures/models/grab-select-bone-angles.tflite',
});
EOF
```

The angle model is 2,272 bytes and took about 2.6 seconds to generate and train.
It passes 66/74 development hand cases, compared with 72/74 for palm coordinates;
74/80 authored hand cases pass. Its synthetic validation acceptance is 90.0%.
See `models/grab-select-bone-angles.evaluation.json` for settings and failures.
It is byte-identical to the angle model checked through LiteRT and the SDK demo.

The tester and demo read the feature format from the manifest. Load the angle
model and its manifest together using **Load model + manifest**. Bone angles
match XR Blocks' `getRelativeBoneAngles` values, while omitting fingertip
distances and between-finger spread. These development results are not an
independent accuracy estimate; real tracked hands have not been evaluated.

`interpolate-four-three.json` supplies endpoints for `sample-gestures`:

```sh
node dist/cli.js sample-gestures examples/gestures/interpolate-four-three.json \
  > artifacts/four-three-candidates.json
node dist/cli.js test-gesture-model examples/gestures/models/grab-select.tflite \
  artifacts/four-three-candidates.json
```

Intermediate poses between these different labels are left unlabeled for review.
The batch tester shows the transition in scores and which poses are rejected.

Run the labeled development checks with:

```sh
node dist/cli.js test-gesture-model examples/gestures/models/grab-select.tflite \
  examples/gestures/evaluation.json
```

These checks improved from 64/74 with the original model at 80% to 72/74 with
the expanded model at 60%. They guided example selection, so they are not an
independent accuracy estimate. Both hands pass all 40 authored poses. The
thumb-only background case incorrectly triggers `shaka` at 60.3% on each hand;
this is retained as a known failure. Results are recorded in
`models/evaluation-report.json`.

The XR Blocks `demos/sim_hand_poses` demo has a **Load grab / select example**
button and an authored-pose selector. To load a different generated model there,
select its `.tflite` and companion `.json` together. The HUD shows both hands'
gesture, confidence, and inference time; individual sliders let you check poses
between training examples.

To refresh the SDK demo after retraining, copy both files from `models/` to
`../xrblocks/demos/sim_hand_poses/models/`, and copy the training configuration
as `grab-select.poses.json` there.

The bundled model achieved 99.8% acceptance accuracy on synthetic validation,
with two rejections and no label confusions. This validation samples the same
pose families as training. Real tracked hands have not been evaluated.
