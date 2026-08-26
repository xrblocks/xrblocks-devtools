import {access, stat} from 'node:fs/promises';
import path from 'node:path';
import {
  createVitest,
  type Reporter,
  type TestCase,
  type TestModule,
} from 'vitest/node';
import type {XRBlocksTestMeta, XRBlocksTestContext} from './internal-types.js';
import {JUDGE_MODEL_ENV} from './judge.js';
import {
  writeResult,
  type EvaluationError,
  type EvaluationResult,
  type TestResult,
  type TestRunResult,
  type TestStatus,
} from './result.js';

const TEST_RUNNER_VERSION = '0.1.0';

export interface AppBinding {
  appDir: string;
  xrblocksRoot?: string;
  entry?: string;
  provenance?: Record<string, string>;
}

export interface RunTestsOptions {
  tests: string;
  app: AppBinding;
  outputDir: string;
  sessionTimeoutMs?: number;
  judgeModel?: string;
}

export async function runTests(
  options: RunTestsOptions
): Promise<EvaluationResult> {
  const startedAt = new Date();
  const result = emptyResult(options, startedAt);

  let preflightFailure: string | undefined;
  try {
    preflightFailure = await preflight(options);
  } catch (error) {
    invalidate(result, toError(error, 'verifier', 'preflight'));
    return finish(options.outputDir, result);
  }

  if (preflightFailure) {
    result.errors.push({
      kind: 'candidate',
      phase: 'preflight',
      message: preflightFailure,
    });
    return finish(options.outputDir, result);
  }
  result.runnable = true;

  const testFile = path.resolve(options.tests);
  const root = path.dirname(testFile);
  const xrblocksRoot = options.app.xrblocksRoot
    ? path.resolve(options.app.xrblocksRoot)
    : undefined;
  let vitest;
  try {
    vitest = await createVitest(
      'test',
      {
        root,
        config: false,
        watch: false,
        run: true,
        environment: 'node',
        fileParallelism: false,
        maxWorkers: 1,
        retry: 0,
        allowOnly: false,
        passWithNoTests: false,
        env: options.judgeModel
          ? {[JUDGE_MODEL_ENV]: options.judgeModel}
          : undefined,
        reporters: [SILENT_REPORTER],
      },
      xrblocksRoot
        ? {
            resolve: {
              alias: [
                {
                  find: '@xrblocks/source',
                  replacement: path.join(xrblocksRoot, 'src'),
                },
                {
                  find: /^three$/,
                  replacement: path.join(
                    xrblocksRoot,
                    'node_modules/three/build/three.module.js'
                  ),
                },
              ],
            },
          }
        : undefined
    );
  } catch (error) {
    invalidate(result, toError(error, 'verifier', 'collection'));
    return finish(options.outputDir, result);
  }

  const provided: XRBlocksTestContext = {
    appDir: path.resolve(options.app.appDir),
    xrblocksRoot,
    entry: options.app.entry,
    artifactDir: path.join(path.resolve(options.outputDir), 'artifacts'),
    sessionTimeoutMs: options.sessionTimeoutMs,
  };
  const previousExitCode = process.exitCode;
  try {
    vitest.provide('xrblocksTest', provided);
    const run = await vitest.start([testFile]);
    collectRun(result, run.testModules, run.unhandledErrors);
  } catch (error) {
    invalidate(result, toError(error, 'verifier', 'collection'));
  } finally {
    try {
      await vitest.close();
    } catch (error) {
      invalidate(result, toError(error, 'verifier', 'cleanup'));
    }
    process.exitCode = previousExitCode;
  }

  if (result.status === 'valid') applyScore(result);
  return finish(options.outputDir, result);
}

const SILENT_REPORTER: Reporter = {};

function collectRun(
  result: EvaluationResult,
  modules: TestModule[],
  unhandledErrors: unknown[]
): void {
  for (const error of unhandledErrors)
    invalidate(result, toError(error, 'verifier', 'collection'));

  const groups = new Map<string, TestResult>();
  for (const module of modules) {
    for (const error of module.errors())
      invalidate(result, toError(error, 'verifier', 'collection'));

    for (const test of module.children.allTests()) {
      const meta = test.meta().xrblocksTest;
      if (!meta) {
        invalidate(result, {
          kind: 'verifier',
          phase: 'collection',
          message: `Test ${test.fullName} did not use @xrblocks/devtools/test.`,
        });
        continue;
      }
      if (!validMeta(meta)) {
        invalidate(result, {
          kind: 'verifier',
          phase: 'collection',
          message: `Test ${test.fullName} has invalid XR Blocks test metadata.`,
        });
        continue;
      }

      const key = `${module.moduleId}:${meta.logicalId}`;
      let logical = groups.get(key);
      if (!logical) {
        logical = {
          id: `${module.relativeModuleId}:${meta.logicalId}`,
          name: meta.name,
          kind: meta.kind,
          required: meta.required,
          status: 'passed',
          runs: [],
        };
        groups.set(key, logical);
      } else if (!sameLogicalTest(logical, meta)) {
        invalidate(result, {
          kind: 'verifier',
          phase: 'collection',
          message: `Expanded test ${test.fullName} has inconsistent metadata.`,
        });
        continue;
      }

      const run = collectTestRun(test, meta, result);
      logical.runs.push(run);
    }
  }

  result.tests = [...groups.values()];
  for (const test of result.tests) {
    if (new Set(test.runs.map((run) => run.id)).size !== test.runs.length) {
      invalidate(result, {
        kind: 'verifier',
        phase: 'collection',
        message: `Expanded test ${test.name} has invalid run allocation.`,
      });
    }
    test.status = combineStatuses(test.runs.map((run) => run.status));
  }

  if (result.tests.length === 0) {
    invalidate(result, {
      kind: 'verifier',
      phase: 'collection',
      message: 'The evaluation did not collect any XR Blocks tests.',
    });
  }
}

function collectTestRun(
  test: TestCase,
  meta: XRBlocksTestMeta,
  evaluation: EvaluationResult
): TestRunResult {
  const testResult = test.result();
  const status = toStatus(testResult.state);
  const errors = testResult.state === 'failed' ? (testResult.errors ?? []) : [];
  const firstError = errors[0];

  for (const error of errors) {
    const classification = classifyError(error);
    if (classification?.kind === 'verifier') {
      invalidate(evaluation, toError(error, 'verifier', classification.phase));
    } else if (classification?.phase === 'session') {
      evaluation.errors.push(toError(error, 'candidate', 'session'));
    }
  }

  return {
    id: meta.runId,
    status,
    durationMs: test.diagnostic()?.duration ?? 0,
    primaryHand: meta.primaryHand,
    secondaryHand: meta.secondaryHand,
    scene: meta.scene,
    realTime: meta.realTime,
    recording: meta.recording,
    agentRuns: meta.agentRuns,
    message: firstError ? errorMessage(firstError) : undefined,
    diagnostics: meta.diagnostics,
  };
}

function applyScore(result: EvaluationResult): void {
  const runs = result.tests.flatMap((test) => test.runs);
  result.totalTests = runs.length;
  result.passedTests = runs.filter((run) => run.status === 'passed').length;
  result.requiredGateFailed = result.tests.some(
    (test) => test.required && test.runs.some((run) => run.status !== 'passed')
  );
  result.score =
    result.requiredGateFailed || result.totalTests === 0
      ? 0
      : round((result.passedTests / result.totalTests) * 100);
}

async function preflight(
  options: RunTestsOptions
): Promise<string | undefined> {
  if (!options || typeof options !== 'object')
    throw new TypeError('runTests options must be an object.');
  if (typeof options.tests !== 'string' || options.tests.trim().length === 0)
    throw new TypeError('tests must be a non-empty path.');
  if (!options.app || typeof options.app !== 'object')
    throw new TypeError('app must be an AppBinding object.');
  if (
    typeof options.app.appDir !== 'string' ||
    options.app.appDir.trim().length === 0
  )
    throw new TypeError('app.appDir must be a non-empty path.');
  if (
    options.app.xrblocksRoot !== undefined &&
    typeof options.app.xrblocksRoot !== 'string'
  )
    throw new TypeError('app.xrblocksRoot must be a path.');
  if (options.app.entry !== undefined && typeof options.app.entry !== 'string')
    throw new TypeError('app.entry must be a string.');
  if (
    options.judgeModel !== undefined &&
    (typeof options.judgeModel !== 'string' ||
      options.judgeModel.trim().length === 0)
  ) {
    throw new TypeError('judgeModel must be a non-empty model name.');
  }
  const tests = path.resolve(options.tests);
  if (!(await isFile(tests)))
    throw new TypeError(`Test file is missing: ${tests}.`);

  const appDir = path.resolve(options.app.appDir);
  if (!(await isDirectory(appDir)))
    return `App directory is missing: ${appDir}.`;
  const index = path.join(appDir, 'index.html');
  if (!(await isFile(index))) return `App entry is missing: ${index}.`;

  if (options.app.xrblocksRoot) {
    const build = path.join(
      path.resolve(options.app.xrblocksRoot),
      'build/xrblocks.js'
    );
    if (!(await isFile(build))) return `XR Blocks build is missing: ${build}.`;
  }

  return undefined;
}

function emptyResult(
  options: RunTestsOptions,
  startedAt: Date
): EvaluationResult {
  return {
    schemaVersion: 3,
    status: 'valid',
    runnable: false,
    score: 0,
    passedTests: 0,
    totalTests: 0,
    requiredGateFailed: false,
    tests: [],
    errors: [],
    provenance: {
      testRunnerVersion: TEST_RUNNER_VERSION,
      app: options.app?.provenance ?? {},
    },
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
  };
}

async function finish(
  outputDir: string,
  result: EvaluationResult
): Promise<EvaluationResult> {
  result.finishedAt = new Date().toISOString();
  await writeResult(outputDir, result);
  return result;
}

function invalidate(result: EvaluationResult, error: EvaluationError): void {
  result.status = 'invalid';
  result.score = null;
  result.errors.push(error);
}

function validMeta(meta: XRBlocksTestMeta): boolean {
  return (
    meta.schemaVersion === 1 &&
    typeof meta.logicalId === 'string' &&
    typeof meta.name === 'string' &&
    (meta.kind === 'test' || meta.kind === 'session') &&
    typeof meta.required === 'boolean' &&
    typeof meta.runId === 'string'
  );
}

function sameLogicalTest(test: TestResult, meta: XRBlocksTestMeta): boolean {
  return (
    test.name === meta.name &&
    test.kind === meta.kind &&
    test.required === meta.required
  );
}

function combineStatuses(statuses: TestStatus[]): TestStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('blocked')) return 'blocked';
  return 'passed';
}

function toStatus(state: string): TestStatus {
  if (state === 'passed') return 'passed';
  if (state === 'failed') return 'failed';
  return 'blocked';
}

function classifyError(
  error: unknown
):
  | {kind: 'candidate' | 'verifier'; phase: 'session' | 'test' | 'cleanup'}
  | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as Record<string, unknown>;
  const kind = value.xrblocksTestFailure;
  const phase = value.xrblocksTestPhase;
  if (
    (kind === 'candidate' || kind === 'verifier') &&
    (phase === 'session' || phase === 'test' || phase === 'cleanup')
  )
    return {kind, phase};
  return classifyError(value.cause);
}

function toError(
  error: unknown,
  kind: EvaluationError['kind'],
  phase: EvaluationError['phase']
): EvaluationError {
  return {
    kind,
    phase,
    message: errorMessage(error),
    stack:
      error && typeof error === 'object' && 'stack' in error
        ? String(error.stack)
        : undefined,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error)
    return String(error.message);
  return String(error);
}

async function isFile(file: string): Promise<boolean> {
  try {
    await access(file);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    await access(directory);
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
