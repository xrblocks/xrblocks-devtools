import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, symlink} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {Quaternion, Vector3} from 'three';
import {serveDirectory} from '../dist/server.js';
import {getChromiumLaunchArgs} from '../dist/browser.js';
import {
  HAND_JOINT_NAMES,
  HAND_POSES,
  NAMED_HAND_POSES,
  resolveHandJoints,
  constrainHandAngles,
  ANGLE_LIMITS_DEGREES,
} from '../dist/hands/index.js';
import {handFeatures} from '../dist/gestures/features.js';
import {gestureTrainingSchema} from '../dist/gestures/schema.js';
import {synthesize} from '../dist/gestures/synthesize.js';
import {fitClassifier, predictFeatures} from '../dist/gestures/classifier.js';
import {encodeTFLite, decodeTFLite} from '../dist/gestures/tflite.js';
import {trainGestures} from '../dist/gestures/train.js';
import {sampleGestures} from '../dist/gestures/sample.js';
import {testGestureModel} from '../dist/gestures/test-model.js';
import {visualize} from '../dist/visualize/index.js';

const directory = path.resolve('artifacts/gesture-check');
await mkdir(directory, {recursive: true});
const config = gestureTrainingSchema.parse({
  ...JSON.parse(await readFile('examples/gestures/grab-select.json', 'utf8')),
  samplesPerPose: 32,
});
assert.throws(() =>
  gestureTrainingSchema.parse({...config, gestures: {only: [{pose: 'fist'}]}})
);
assert.throws(() =>
  gestureTrainingSchema.parse({...config, keypointStddevMeters: -1})
);
assert.throws(() =>
  gestureTrainingSchema.parse({
    ...config,
    gestures: {...config.gestures, bad: [{rotations: {missing: [0, 0, 0]}}]},
  })
);
await assert.rejects(
  trainGestures({
    config,
    out: path.join(directory, 'cancelled.tflite'),
    signal: AbortSignal.abort(),
  })
);
for (const hand of ['left', 'right']) {
  for (const pose of NAMED_HAND_POSES) {
    const joints = resolveHandJoints(hand, HAND_POSES[pose]);
    assert.equal(joints.length, 25);
    assert(joints.every(({t, r}) => [...t, ...r].every(Number.isFinite)));
    const angles = constrainHandAngles(HAND_POSES[pose]);
    for (const [joint, limits] of Object.entries(ANGLE_LIMITS_DEGREES)) {
      limits.forEach(([min, max], axis) => {
        const degrees = (angles[joint][axis] * 180) / Math.PI;
        assert(degrees >= min - 1e-8 && degrees <= max + 1e-8);
      });
    }
    const points = joints.map(({t}) => new Vector3().fromArray(t));
    const expected = handFeatures(points, hand);
    assert(expected);
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 2, 3).normalize(),
      0.8
    );
    const transformed = points.map((point) =>
      point
        .clone()
        .applyQuaternion(rotation)
        .multiplyScalar(1.3)
        .add(new Vector3(4, -2, 7))
    );
    const actual = handFeatures(transformed, hand);
    assert(actual.every((v, i) => Math.abs(v - expected[i]) < 1e-5));
  }
}
assert.equal(handFeatures([], 'right'), null);
const data = await synthesize(config);
const repeated = await synthesize(config);
assert.deepEqual(data, repeated);
const classifier = await fitClassifier(data.training, data.labels.length);
const manifest = {
  format: 'xrblocks-hand-gestures',
  version: 1,
  features: 'palm-local-xyz-v1',
  joints: [...HAND_JOINT_NAMES],
  labels: data.labels,
  threshold: config.threshold,
};
await writeFile(
  path.join(directory, 'model.tflite'),
  encodeTFLite(classifier, manifest)
);
await writeFile(path.join(directory, 'model.json'), JSON.stringify(manifest));
await writeFile(
  path.join(directory, 'reject.json'),
  JSON.stringify({...manifest, threshold: 1})
);
const result = await trainGestures({
  config,
  out: path.join(directory, 'command.tflite'),
});
assert.deepEqual(
  await readFile(result.out),
  await readFile(path.join(directory, 'model.tflite'))
);
assert(result.syntheticValidation.accuracy > 0.9);
const decoded = decodeTFLite(await readFile(result.out));
assert.deepEqual(decoded.manifest, manifest);
assert.deepEqual(decoded.classifier, classifier);
assert.throws(() => decodeTFLite(new Uint8Array(8)));
const truncated = (await readFile(result.out)).subarray(0, 20);
assert.throws(() => decodeTFLite(truncated));
const badOffset = new Uint8Array(await readFile(result.out));
new DataView(badOffset.buffer).setUint32(0, 0x7fffffff, true);
assert.throws(() => decodeTFLite(badOffset));
const corruptWeights = encodeTFLite(classifier, manifest);
const weightBytes = new Uint8Array(classifier.weights[0].buffer);
const weightOffset = Buffer.from(corruptWeights).indexOf(weightBytes);
assert(weightOffset >= 0);
new DataView(corruptWeights.buffer).setFloat32(weightOffset, NaN, true);
assert.throws(() => decodeTFLite(corruptWeights));
const interpolated = sampleGestures({
  from: {...config.gestures.four[0], label: 'four'},
  to: {...config.gestures.three[0], label: 'three'},
  steps: 5,
});
assert.equal(interpolated.poses.length, 5);
assert.equal(interpolated.poses[0].interpolation.suggestedLabel, 'four');
assert.equal(interpolated.poses[2].interpolation.suggestedLabel, null);
assert.equal(interpolated.poses[4].interpolation.suggestedLabel, 'three');
assert.equal(
  interpolated.poses[2].rotations['pinky-finger-phalanx-proximal'][0],
  (config.gestures.four[0].rotations['pinky-finger-phalanx-proximal'][0] +
    config.gestures.three[0].rotations['pinky-finger-phalanx-proximal'][0]) /
    2
);
assert(!('expected' in interpolated.poses[2]));
const sameLabel = sampleGestures({
  from: {...config.gestures.four[0], label: 'four'},
  to: {...config.gestures.four[1], label: 'four'},
  steps: 3,
});
assert.equal(sameLabel.poses[1].interpolation.suggestedLabel, 'four');
assert.equal(sameLabel.poses[1].interpolation.labelSource, 'shared-endpoints');
const adjusted = sampleGestures({
  from: {
    label: 'four',
    rotations: {'index-finger-phalanx-proximal': [5, 0, 0]},
  },
  to: {label: 'four'},
  steps: 3,
});
assert.equal(adjusted.poses[0].interpolation.suggestedLabel, null);
assert.equal(adjusted.poses[1].interpolation.suggestedLabel, null);
assert.equal(adjusted.warnings.length, 1);
const batchPoses = Object.entries(config.gestures).flatMap(
  ([expected, poses]) =>
    poses.map((pose, index) => ({
      ...pose,
      id: `${expected}-${index}`,
      expected,
    }))
);
const batch = await testGestureModel({model: result.out, poses: batchPoses});
assert(batch.evaluation.accuracy > 0.9);
assert.equal(batch.results.length, batchPoses.length * 2);
assert(
  !(
    'evaluation' in
    (await testGestureModel({model: result.out, poses: interpolated.poses}))
  )
);
await assert.rejects(
  testGestureModel({
    model: result.out,
    poses: [{id: 'duplicate'}, {id: 'duplicate'}],
  })
);
await assert.rejects(
  testGestureModel({model: result.out, poses: [{expected: 'unknown-label'}]})
);
await assert.rejects(
  testGestureModel({model: result.out, poses: [{}]}, AbortSignal.abort())
);
await build({
  stdin: {
    contents: `
    import {loadLiteRt, loadAndCompile, Tensor} from '@litertjs/core';
    import {TFLiteGestureRecognizer} from './dist/gestures/recognizer.js';
    import {HAND_JOINT_NAMES} from './dist/hands/types.js';
    export async function runCases(cases) {
      await loadLiteRt(new URL('./wasm/', location.href).href);
      const model = await loadAndCompile('./model.tflite', {accelerator: 'wasm'});
      const recognizer = await TFLiteGestureRecognizer.load('./model.tflite', './model.json');
      try {
        const results = [];
        for (const item of cases) {
          const input = new Tensor(new Float32Array(item.features), [1, 75]);
          let outputs = [];
          try {
            outputs = await model.run([input]);
            results.push({scores: Array.from(await outputs[0].data())});
          } finally {
            outputs.forEach((tensor) => tensor.delete());
            input.delete();
          }
        }
        const points = cases[0].points;
        const context = {handLabel: 'right', getJoint: (name) => points[HAND_JOINT_NAMES.indexOf(name)]};
        const pair = await Promise.all([recognizer.recognize(context), recognizer.recognize(context)]);
        results[0].recognition = pair;
        results[0].background = await recognizer.recognize({handLabel: 'left', getJoint: (name) => cases[1].points[HAND_JOINT_NAMES.indexOf(name)]});
        results[0].missing = await recognizer.recognize({handLabel: 'right', getJoint: () => undefined});
        const strict = await TFLiteGestureRecognizer.load('./model.tflite', './reject.json');
        try {
          results[0].lowConfidence = await strict.recognize(context);
        } finally {
          strict.dispose();
        }
        recognizer.dispose();
        await recognizer.recognize(context).then(() => {throw new Error('Disposed recognizer accepted input.');}, () => {});
        return results;
      } finally {
        recognizer.dispose();
        model.delete();
      }
    }`,
    resolveDir: process.cwd(),
    sourcefile: 'gesture-check.js',
  },
  outfile: path.join(directory, 'check.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  logLevel: 'silent',
});
await symlink(
  path.resolve('node_modules/@litertjs/core/wasm'),
  path.join(directory, 'wasm'),
  'dir'
).catch((error) => {
  if (error.code !== 'EEXIST') throw error;
});
await writeFile(
  path.join(directory, 'index.html'),
  '<!doctype html><title>Gesture model check</title>'
);
let server;
let browser;
try {
  server = await serveDirectory(directory);
  browser = await chromium.launch({
    headless: true,
    args: getChromiumLaunchArgs(),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(server.url);
  const points = resolveHandJoints(
    'right',
    constrainHandAngles(config.gestures.grab[0].rotations)
  ).map(({t}) => ({x: t[0], y: t[1], z: t[2]}));
  const cases = [
    {features: Array.from(handFeatures(points, 'right')), points},
    (() => {
      const points = resolveHandJoints(
        'left',
        constrainHandAngles(config.gestures.other[0].rotations)
      ).map(({t}) => ({x: t[0], y: t[1], z: t[2]}));
      return {features: Array.from(handFeatures(points, 'left')), points};
    })(),
    ...data.validation.map(({features}) => ({features: Array.from(features)})),
  ];
  const actual = await page.evaluate(async (cases) => {
    const {runCases} = await import('./check.js');
    return runCases(cases);
  }, cases);
  let maximumError = 0;
  actual.forEach(({scores}, i) => {
    const expected = predictFeatures(
      classifier,
      new Float32Array(cases[i].features)
    );
    scores.forEach((value, j) => {
      maximumError = Math.max(maximumError, Math.abs(value - expected[j]));
    });
  });
  assert(maximumError < 1e-5, `TFLite error: ${maximumError}`);
  assert.deepEqual(actual[0].recognition, [
    {grab: {confidence: actual[0].scores[0]}},
    {grab: {confidence: actual[0].scores[0]}},
  ]);
  assert.deepEqual(actual[0].missing, {});
  assert.deepEqual(actual[0].background, {});
  assert.deepEqual(actual[0].lowConfidence, {});
  console.log(
    JSON.stringify(
      {
        syntheticValidation: result.syntheticValidation,
        tfliteCases: cases.length,
        maximumError,
      },
      null,
      2
    )
  );
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
await visualize({
  kind: 'hand',
  pose: 'fist',
  out: path.join(directory, 'fist.png'),
});
await visualize({
  kind: 'hand',
  pose: 'relaxed',
  rotations: {'index-finger-phalanx-proximal': [1, 0, 0]},
  out: path.join(directory, 'custom.png'),
});
console.log(`Hand previews and model artifacts: ${directory}`);
