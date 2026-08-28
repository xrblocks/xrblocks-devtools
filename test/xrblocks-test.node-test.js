import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runTests} from '../dist/test/index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(root, 'fixtures/xrblocks-test');
const appDir = path.join(fixtures, 'app');

test('scores ordinary tests by pass count', async (t) => {
  const {result, outputDir} = await run(t, 'scoring.test.mjs');

  assert.equal(result.status, 'valid');
  assert.equal(result.score, 50);
  assert.equal(result.passedTests, 1);
  assert.equal(result.totalTests, 2);
  assert.deepEqual(
    result.tests.map(({name, status}) => [name, status]),
    [
      ['passes', 'passed'],
      ['fails', 'failed'],
    ]
  );
  assert.equal(
    JSON.parse(await readFile(path.join(outputDir, 'result.json'))).score,
    50
  );
});

test('gates the score when a required test fails', async (t) => {
  const {result} = await run(t, 'required.test.mjs');

  assert.equal(result.passedTests, 1);
  assert.equal(result.totalTests, 2);
  assert.equal(result.requiredGateFailed, true);
  assert.equal(result.score, 0);
});

test('counts hand variants as individual tests', async (t) => {
  const {result} = await run(t, 'variants.test.mjs');

  assert.equal(result.status, 'valid');
  assert.equal(result.passedTests, 2);
  assert.equal(result.totalTests, 2);
  assert.equal(result.score, 100);
  assert.equal(result.tests.length, 1);
  assert.equal(result.tests[0].runs.length, 2);
});

test('runs SDK and manifest scene variants', async (t) => {
  const {result} = await run(t, 'scenario.test.mjs');

  assert.equal(result.status, 'valid');
  assert.equal(result.score, 100);
  assert.equal(result.totalTests, 2);
  assert.equal(result.tests[0].runs[0].realTime, false);
  assert.deepEqual(
    result.tests[0].runs.map((run) => run.scene),
    ['Office', {path: './scenes/table.json'}]
  );
});

test('records session checkpoints without actor artifact folders', async (t) => {
  const {result} = await run(t, 'session.test.mjs');

  assert.equal(result.status, 'valid');
  assert.equal(result.passedTests, 2);
  assert.equal(result.totalTests, 2);
});

async function run(t, fixture) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'xrblocks-test-'));
  t.after(() => rm(outputDir, {recursive: true, force: true}));

  const result = await runTests({
    tests: path.join(fixtures, fixture),
    app: {appDir},
    outputDir,
  });
  return {result, outputDir};
}
