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
