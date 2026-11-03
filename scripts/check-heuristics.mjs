import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  inspectHandPoses,
  testGestureDetector,
} from '../dist/gestures/heuristics.js';
import {testGestureDetectorSchema} from '../dist/gestures/schema.js';
import {parseCommand} from '../dist/command-config.js';
import {HAND_POSES, resolveHandJoints} from '../dist/hands/index.js';
import {sampleGestures} from '../dist/gestures/sample.js';

const directory = path.resolve('artifacts/heuristics-check');
await mkdir(directory, {recursive: true});
const ownedDirectories = async () =>
  (await readdir(os.tmpdir(), {withFileTypes: true}))
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('xrblocks-heuristics-')
    )
    .map((entry) => entry.name)
    .sort();
const before = await ownedDirectories();
const poses = JSON.parse(
  await readFile('examples/gestures/heuristics/poses.json', 'utf8')
);
const input = {path: 'examples/gestures/heuristics/four.js'};
const inspected = await inspectHandPoses({poses});
assert.equal(inspected.results.length, poses.length * 2);
for (const result of inspected.results) {
  const pose = poses.find((pose) => pose.id === result.id);
  const points = resolveHandJoints(result.hand, {
    ...HAND_POSES[pose.pose ?? 'neutral'],
    ...pose.rotations,
  }).map(({t}) => t);
  const width = Math.hypot(
    ...points[5].map((value, i) => value - points[20][i])
  );
  assert(Math.abs(width - result.metrics.palm.widthMeters) < 1e-10);
  const pinch = result.metrics.fingertipDistances.find(
    (d) => d.from === 'thumb' && d.to === 'index'
  );
  assert(Math.abs(pinch.palmWidths * width - pinch.meters) < 1e-10);
  assert.equal(result.metrics.fingers.index.bendCosines.length, 3);
  assert.equal(result.metrics.thumb.bendCosines.length, 2);
  assert.equal(result.metrics.palm.normal.length, 3);
}
const baseline = await testGestureDetector({input, poses});
assert.equal(baseline.evaluation.correct, poses.length * 2);
assert(baseline.results.some((result) => result.accepted.includes('four')));
assert(baseline.results.some((result) => result.accepted.length === 0));
assert(baseline.results.every((result) => result.scores.four.data));
const augmented = await testGestureDetector({
  input,
  poses,
  augmentation: {samplesPerPose: 8},
});
const repeated = await testGestureDetector({
  input,
  poses,
  augmentation: {samplesPerPose: 8},
});
assert.deepEqual(augmented, repeated);
assert.equal(augmented.results.length, poses.length * 2 * 8);
const candidates = sampleGestures({
  from: {
    pose: poses[0].pose ?? 'neutral',
    rotations: poses[0].rotations,
    label: 'four',
  },
  to: {pose: 'neutral'},
  steps: 5,
});
const unlabeled = await testGestureDetector({input, poses: candidates.poses});
assert(!('evaluation' in unlabeled));
const overlapSource = `
import {HeuristicGestureRecognizer} from 'xrblocks';
const recognizer = new HeuristicGestureRecognizer(false).registerGesture('a', () => ({confidence: 0.9, data: {sdk: true}}));
export const detectors = {
  a: context => recognizer.recognize(context).a,
  b: () => ({confidence: 0.8}),
  absent: () => undefined,
};`;
const overlap = await testGestureDetector({
  input: {source: overlapSource},
  poses: [{expected: ['a', 'b']}, {expected: null}],
  minimumConfidence: 0.6,
});
assert.equal(overlap.overlaps, 4);
assert.equal(overlap.evaluation.correct, 2);
assert.equal(overlap.evaluation.falsePositives, 4);
assert.equal(overlap.results[0].scores.absent, null);
assert.equal(overlap.results[0].scores.a.data.sdk, true);
const disabled = await testGestureDetector({
  input: {source: overlapSource},
  poses: [{expected: 'a'}],
  configurations: {b: {enabled: false}},
});
assert(disabled.results.every((result) => result.accepted.join() === 'a'));
const missing = await testGestureDetector({
  input: {source: 'export const detectors = {absent: () => undefined};'},
  poses: [{expected: null}],
  minimumConfidence: 0,
});
assert.equal(missing.evaluation.correct, 2);
await assert.rejects(
  testGestureDetector({input, poses: [{expected: 'unknown'}]}),
  /Unknown expected/
);
await assert.rejects(
  testGestureDetector({
    input,
    poses: [{}],
    configurations: {unknown: {enabled: true}},
  }),
  /Unknown configured/
);
await assert.rejects(
  testGestureDetector({
    input: {
      source: 'export const detectors = {bad: () => ({confidence: NaN})};',
    },
    poses: [{}],
  }),
  /bad failed at pose-0\/left\/sample-0/
);
await assert.rejects(
  testGestureDetector({
    input: {
      source: 'export const detectors = {bad: async () => ({confidence: 1})};',
    },
    poses: [{}],
  }),
  /Return undefined/
);
await assert.rejects(
  testGestureDetector({
    input: {
      source:
        'export const detectors = {bad: () => ({confidence: 1, data: new Date()})};',
    },
    poses: [{}],
  }),
  /Diagnostic data/
);
await assert.rejects(
  inspectHandPoses({poses: [{id: 'duplicate'}, {id: 'duplicate'}]}),
  /unique/
);
await assert.rejects(
  testGestureDetector({
    input: {
      source:
        'export const detectors = {large: () => ({confidence: 1, data: {text: "x".repeat(40000)}})};',
    },
    poses: Array.from({length: 110}, () => ({})),
  }),
  /Batch diagnostics exceed/
);
await assert.rejects(
  testGestureDetector({input, poses: [{}]}, AbortSignal.abort()),
  /abort/i
);
assert.throws(
  () =>
    testGestureDetectorSchema.parse({
      input,
      poses: Array.from({length: 51}, () => ({})),
      augmentation: {samplesPerPose: 200},
    }),
  /20,000/
);
assert.deepEqual(parseCommand(['inspect-hand-poses', 'poses.json']), {
  kind: 'inspect-hand-poses',
  input: 'poses.json',
});
assert.deepEqual(
  parseCommand(['test-gesture-detector', 'four.js', 'poses.json']),
  {kind: 'test-gesture-detector', detector: 'four.js', input: 'poses.json'}
);
assert.throws(
  () => parseCommand(['test-gesture-detector', 'four.js']),
  /Usage/
);
assert.deepEqual(await ownedDirectories(), before);
await writeFile(
  path.join(directory, 'inspection.json'),
  JSON.stringify(inspected, null, 2)
);
await writeFile(
  path.join(directory, 'baseline.json'),
  JSON.stringify(baseline, null, 2)
);
await writeFile(
  path.join(directory, 'augmented.json'),
  JSON.stringify(augmented, null, 2)
);
console.log(
  JSON.stringify(
    {
      baseline: baseline.evaluation,
      augmented: augmented.evaluation,
      overlapChecks: overlap.evaluation,
      cleanup: true,
    },
    null,
    2
  )
);
