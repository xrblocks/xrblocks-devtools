import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it as vitestIt,
  vi,
  type TestContext,
  type TestFunction,
  type TestOptions,
} from 'vitest';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {SimulatorEnvironment} from 'xrblocks';
import {AiUnavailableError} from '../ai.js';
import {
  DEFAULT_SESSION_TIMEOUT_MS,
  XRBlocksSession,
  type PhysicalHand,
  type SimulatorObjectInput,
  type Viewport,
} from '../session/index.js';
import {XRBlocksTestFailure} from './failure.js';
import type {XRBlocksTestMeta} from './internal-types.js';

export {afterAll, afterEach, beforeAll, beforeEach, describe, expect, vi};

type VitestOptions = Omit<
  TestOptions,
  'concurrent' | 'fails' | 'meta' | 'repeats' | 'retry' | 'sequential'
>;

export interface XRBlocksTestOptions extends VitestOptions {
  required?: boolean;
}

export interface SessionTestOptions extends XRBlocksTestOptions {
  switchHands?: boolean;
  scenes?: SceneVariant[];
  video?: string;
  realTime?: boolean;
  /** Browser viewport dimensions in pixels. */
  viewport?: Viewport;
  /** Recorded video dimensions in pixels. Defaults to the browser viewport. */
  videoSize?: Viewport;
  /** Load and enforce the active simulator environment navmesh. */
  simulatorNavMesh?: boolean;
  simulatorObjects?: SimulatorObjectInput[];
}

export type BuiltInScene = NonNullable<SimulatorEnvironment['name']>;
export type SceneVariant = BuiltInScene | {path: string};

export interface SessionTestRun {
  primaryHand: PhysicalHand;
  secondaryHand: PhysicalHand;
  scene?: SceneVariant;
}

export type SessionTestFunction = (
  session: XRBlocksSession,
  run: Readonly<SessionTestRun>,
  context: TestContext
) => void | Promise<void>;

interface XRBlocksItCall {
  (name: string, callback: TestFunction, timeout?: number): void;
  (name: string, options: XRBlocksTestOptions, callback: TestFunction): void;
}

export interface XRBlocksIt extends XRBlocksItCall {
  only: XRBlocksItCall;
  skip: XRBlocksItCall;
  todo(name: string, options?: XRBlocksTestOptions): void;
}

type VitestItCall = (
  name: string,
  options?: TestOptions,
  callback?: TestFunction
) => void;

let nextLogicalId = 0;
export const it: XRBlocksIt = Object.assign(makeIt(vitestIt), {
  only: makeIt(vitestIt.only),
  skip: makeIt(vitestIt.skip),
  todo: (name: string, options: XRBlocksTestOptions = {}) => {
    registerPlainTest(vitestIt.todo, name, options);
  },
});

export function it_session(name: string, callback: SessionTestFunction): void;
export function it_session(
  name: string,
  options: SessionTestOptions,
  callback: SessionTestFunction
): void;
export function it_session(
  name: string,
  optionsOrCallback: SessionTestOptions | SessionTestFunction,
  suppliedCallback?: SessionTestFunction
): void {
  const options =
    typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  const callback =
    typeof optionsOrCallback === 'function'
      ? optionsOrCallback
      : suppliedCallback;
  if (!callback) throw new TypeError(`Session test ${name} needs a callback.`);

  const plan = planSessionRuns(name, options);
  const {
    switchHands: _switchHands,
    scenes: _scenes,
    video: _video,
    realTime: _realTime,
    viewport: _viewport,
    videoSize: _videoSize,
    simulatorNavMesh: _simulatorNavMesh,
    ...sharedOptions
  } = options;
  for (const run of plan.runs) {
    const meta: XRBlocksTestMeta = {
      schemaVersion: 1,
      logicalId: plan.logicalId,
      name,
      kind: 'session',
      required: plan.required,
      runId: run.id,
      primaryHand: run.primaryHand,
      secondaryHand: run.secondaryHand,
      scene: run.scene,
      realTime: options.realTime ?? false,
    };

    vitestIt(
      `${name} [${run.primaryHand}, ${sceneLabel(run.scene)}]`,
      testOptions(
        {
          ...sharedOptions,
          timeout: sharedOptions.timeout ?? DEFAULT_SESSION_TIMEOUT_MS,
        },
        meta
      ),
      async (context) => {
        await runSessionTest(
          callback,
          run,
          context,
          meta,
          options.video,
          options.realTime ?? false,
          options.viewport,
          options.videoSize,
          options.simulatorNavMesh,
          options.simulatorObjects
        );
      }
    );
  }
}

function makeIt(base: VitestItCall): XRBlocksItCall {
  return (
    name: string,
    optionsOrCallback: XRBlocksTestOptions | TestFunction,
    callbackOrTimeout?: TestFunction | number
  ): void => {
    if (typeof optionsOrCallback === 'function') {
      const timeout =
        typeof callbackOrTimeout === 'number' ? callbackOrTimeout : undefined;
      registerPlainTest(base, name, {timeout}, optionsOrCallback);
      return;
    }
    if (typeof callbackOrTimeout !== 'function')
      throw new TypeError(`Test ${name} needs a callback.`);
    registerPlainTest(base, name, optionsOrCallback, callbackOrTimeout);
  };
}

function registerPlainTest(
  base: VitestItCall,
  name: string,
  options: XRBlocksTestOptions,
  callback?: TestFunction
): void {
  const meta: XRBlocksTestMeta = {
    schemaVersion: 1,
    logicalId: logicalId(),
    name,
    kind: 'test',
    required: options.required ?? false,
    runId: 'default',
  };
  base(name, testOptions(options, meta), callback);
}

interface PlannedSessionRun extends SessionTestRun {
  id: string;
  videoSuffix: string;
}

function planSessionRuns(
  name: string,
  options: SessionTestOptions
): {
  logicalId: string;
  required: boolean;
  runs: PlannedSessionRun[];
} {
  const switchHands = options.switchHands;
  if (switchHands !== undefined && typeof switchHands !== 'boolean')
    throw new TypeError(`Session test ${name} switchHands must be a Boolean.`);
  const hands: PhysicalHand[] = switchHands ? ['right', 'left'] : ['right'];

  const scenes = normalizeScenes(name, options.scenes);
  validateVideoName(name, options.video);
  if (options.realTime !== undefined && typeof options.realTime !== 'boolean')
    throw new TypeError(`Session test ${name} realTime must be a Boolean.`);
  const required = options.required ?? false;
  const runs: PlannedSessionRun[] = [];

  for (const primaryHand of hands) {
    for (const [sceneIndex, scene] of scenes.entries()) {
      const suffixes = [];
      if (hands.length > 1) suffixes.push(primaryHand);
      if (scenes.length > 1) suffixes.push(`scene-${sceneIndex + 1}`);
      runs.push({
        id: `${primaryHand}:${sceneLabel(scene)}`,
        primaryHand,
        secondaryHand: primaryHand === 'right' ? 'left' : 'right',
        scene,
        videoSuffix: suffixes.length > 0 ? `-${suffixes.join('-')}` : '',
      });
    }
  }

  return {logicalId: logicalId(), required, runs};
}

function normalizeScenes(
  name: string,
  scenes: SceneVariant[] | undefined
): (SceneVariant | undefined)[] {
  if (scenes === undefined || scenes.length === 0) return [undefined];
  const seen = new Set<string>();
  for (const scene of scenes) {
    if (
      (typeof scene !== 'string' || scene.trim().length === 0) &&
      (!scene ||
        typeof scene !== 'object' ||
        typeof scene.path !== 'string' ||
        scene.path.trim().length === 0)
    )
      throw new TypeError(
        `Session test ${name} scenes must be SDK environment names or {path: string}.`
      );
    const label = sceneLabel(scene);
    if (seen.has(label))
      throw new TypeError(`Session test ${name} repeats scene ${label}.`);
    seen.add(label);
  }
  return scenes;
}

async function runSessionTest(
  callback: SessionTestFunction,
  run: PlannedSessionRun,
  context: TestContext,
  meta: XRBlocksTestMeta,
  videoName: string | undefined,
  realTime: boolean,
  viewport: Viewport | undefined,
  videoSize: Viewport | undefined,
  simulatorNavMesh?: boolean,
  simulatorObjects?: SimulatorObjectInput[]
): Promise<void> {
  const provided = inject('xrblocksTest');
  const videoStem = videoName ? `${videoName}${run.videoSuffix}` : undefined;
  const videoOut = videoStem
    ? path.join(provided.artifactDir, `${videoStem}.mp4`)
    : undefined;
  const timelineOut = videoStem
    ? path.join(provided.artifactDir, `${videoStem}.timeline.json`)
    : undefined;
  let session: XRBlocksSession;
  try {
    session = await XRBlocksSession.open({
      appDir: provided.appDir,
      xrblocksRoot: provided.xrblocksRoot,
      entry: provided.entry,
      realTime,
      viewport,
      recordVideo:
        videoOut && timelineOut
          ? {
              out: videoOut,
              timelineOut,
              trim: true,
              paddingMs: 500,
              size: videoSize,
            }
          : undefined,
      recordAgent: {
        outDir: path.join(
          provided.artifactDir,
          'agent',
          `${meta.logicalId}-${shortHash(meta.runId)}`
        ),
        onResult(result) {
          if (!result.artifacts) return;
          (meta.agentRuns ??= []).push({
            status: result.status,
            trajectory: relativeArtifactPath(
              provided.artifactDir,
              result.artifacts.trajectoryPath
            ),
            images: result.artifacts.imagePaths.map((image) =>
              relativeArtifactPath(provided.artifactDir, image)
            ),
          });
        },
      },
      timeoutMs: provided.sessionTimeoutMs,
      simulatorNavMesh,
      simulatorObjects,
      signal: context.signal,
    });
  } catch (error) {
    throw new XRBlocksTestFailure(
      'candidate',
      'session',
      `App session did not start: ${errorMessage(error)}`,
      {cause: error}
    );
  }

  if (run.scene) {
    try {
      await session.invoke('setSimulatorEnvironment', run.scene);
    } catch (error) {
      await session.close().catch(() => undefined);
      meta.diagnostics = session.diagnostics;
      throw new XRBlocksTestFailure(
        'candidate',
        'session',
        `Scene ${sceneLabel(run.scene)} did not load: ${errorMessage(error)}`,
        {cause: error}
      );
    }
  }

  let callbackError: unknown;
  try {
    await callback(
      session,
      {
        primaryHand: run.primaryHand,
        secondaryHand: run.secondaryHand,
        scene: run.scene,
      },
      context
    );
  } catch (error) {
    callbackError =
      error instanceof AiUnavailableError
        ? new XRBlocksTestFailure('verifier', 'test', error.message, {
            cause: error,
          })
        : error;
  }

  try {
    await session.close();
    meta.diagnostics = session.diagnostics;
    if (session.videoTimeline) {
      meta.video = relativeArtifactPath(
        provided.artifactDir,
        session.videoTimeline.outputVideoPath
      );
      meta.videoTimeline = relativeArtifactPath(
        provided.artifactDir,
        timelineOut!
      );
    }
  } catch (error) {
    throw new XRBlocksTestFailure(
      'verifier',
      'cleanup',
      `Session cleanup failed: ${errorMessage(error)}`,
      {
        cause: callbackError
          ? new AggregateError([callbackError, error])
          : error,
      }
    );
  }

  if (callbackError !== undefined) throw callbackError;
}

function sceneLabel(scene: SceneVariant | undefined): string {
  if (scene === undefined) return 'default';
  return typeof scene === 'string' ? scene : scene.path;
}

function shortHash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function testOptions(
  options: XRBlocksTestOptions,
  meta: XRBlocksTestMeta
): TestOptions {
  const {required: _required, ...vitestOptions} = options;
  return {
    ...vitestOptions,
    concurrent: false,
    repeats: 0,
    retry: 0,
    meta: {xrblocksTest: meta},
  };
}

const VIDEO_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function validateVideoName(name: string, video: string | undefined): void {
  if (video !== undefined && !VIDEO_NAME.test(video))
    throw new TypeError(
      `Session test ${name} video must be a simple name matching ${VIDEO_NAME.source}.`
    );
}

function relativeArtifactPath(root: string, file: string): string {
  return path.posix.join(
    'artifacts',
    path.relative(root, file).split(path.sep).join('/')
  );
}

function logicalId(): string {
  nextLogicalId += 1;
  return `test-${nextLogicalId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
