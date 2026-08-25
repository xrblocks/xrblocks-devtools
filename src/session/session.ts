import {URL} from 'node:url';
import {runSessionAct, type ActOptions, type ActResult} from '../agent.js';
import {writeActArtifacts} from '../agent-artifacts.js';
import type {MaterializedAppWorkspace} from './workspace.js';
import type {RunningServer} from '../server.js';
import {
  type SessionVideoRecordingOptions,
  type VideoTimeline,
} from './video.js';
import {
  DEFAULT_SESSION_TIMEOUT_MS,
  HAND_POSE_JOINT_NAMES,
  type AngularSpeedOptions,
  type BrowserDiagnostics,
  type EulerRotation,
  type PhysicalHand,
  type HandPoseRotations,
  type LinearMotion,
  type LinearSpeedOptions,
  type NamedHandPose,
  type ObjectIdentity,
  type ObjectInspection,
  type SceneContextOptions,
  type SessionSimulator,
  type SimulatorObjectInput,
  type SimulatorObjectRecord,
  type SimulatorObjectUpdate,
  type Vec3Tuple,
  type Viewport,
} from './types.js';
import type {JsonObject} from '../types.js';
import {runCleanupStep, throwCleanupErrors} from '../cleanup.js';
import type {AudioInjection, AudioInjectionResult} from './audio.js';
import {materializeSimulatorObjectInputs} from './simulator-objects.js';
import {
  productionSessionDependencies,
  type SessionDependencies,
  type SessionRuntimeAdapter,
  type SessionVideoAdapter,
} from './session-dependencies.js';
import {
  ANGULAR_SPEED,
  angularMotionStep,
  boundedSpeed,
  HAND_MOVE_SPEED,
  HAND_POSE_TRANSITION_MS,
  linearMotionStep,
  VIEWER_MOVE_SPEED,
} from './motion.js';
type XRBlocksSessionTarget =
  | {
      appDir: string;
      xrblocksRoot?: string;
      /** App page path relative to the materialized app directory. */
      entry?: string;
      url?: never;
    }
  | {
      url: string;
      appDir?: never;
      xrblocksRoot?: never;
      entry?: never;
    };

export type XRBlocksSessionConfig = XRBlocksSessionTarget & {
  headless?: boolean;
  timeoutMs?: number;
  viewport?: Viewport;
  realTime?: boolean;
  /** Play injected microphone audio through browser output. */
  monitorAudio?: boolean;
  /** Enable the simulator's finite controller reach distance. */
  simulatorReachLimit?: boolean;
  /** Load and enforce the active simulator environment navmesh. */
  simulatorNavMesh?: boolean;
  /** Initial simulator objects to spawn on session start. */
  simulatorObjects?: SimulatorObjectInput[];
  /** Module specifier or URL that the target page can load. */
  embodiedControlImport?: string;
  recordVideo?: SessionVideoRecordingOptions;
  /** Record each act() trajectory and its observation images. */
  recordAgent?: {
    outDir: string;
    onResult?: (result: ActResult) => void;
  };
  signal?: AbortSignal;
};

export type XRBlocksSessionInfo = {
  url: string;
  appDir?: string;
  initResult: unknown;
};

export type SessionObjects = {
  findByTag(tag: string): Promise<Array<ObjectIdentity & {tag: string}>>;
  inspect(target: SessionTarget): Promise<ObjectInspection>;
};

export type SessionTarget =
  string | [number, number, number] | {tag: string; id?: string};

export type SimulatorNavigationResult = {
  completed: true;
  position: [number, number, number];
  constrained: boolean;
};

export class XRBlocksSession {
  readonly config: XRBlocksSessionConfig;
  readonly objects: SessionObjects;
  readonly simulator: SessionSimulator;
  info?: XRBlocksSessionInfo;
  videoTimeline?: VideoTimeline;
  private workspace?: MaterializedAppWorkspace;
  private server?: RunningServer;
  private runtime?: SessionRuntimeAdapter;
  private videoRecorder?: SessionVideoAdapter;
  private retainedDiagnostics: BrowserDiagnostics = emptyDiagnostics();
  private started = false;
  private closing?: Promise<void>;
  private removeAbortListener?: () => void;
  private acting?: Promise<ActResult>;
  private agentRunCount = 0;

  private readonly dependencies: SessionDependencies;

  constructor(config: XRBlocksSessionConfig);
  /** @internal */
  constructor(config: XRBlocksSessionConfig, dependencies: SessionDependencies);
  constructor(
    config: XRBlocksSessionConfig,
    dependencies: SessionDependencies = productionSessionDependencies
  ) {
    this.config = config;
    this.dependencies = dependencies;
    this.objects = {
      findByTag: (tag: string) =>
        this.requireRuntime().invoke<Array<ObjectIdentity & {tag: string}>>(
          'findObjectsByTag',
          tag
        ),
      inspect: (target: SessionTarget) =>
        this.requireRuntime().invoke<ObjectInspection>('inspectObject', {
          target,
        }),
    };
    this.simulator = {
      addObjects: async (definitions: SimulatorObjectInput[]) => {
        const materialized =
          await materializeSimulatorObjectInputs(definitions);
        return this.requireRuntime().invoke<SimulatorObjectRecord[]>(
          'addSimulatorObjects',
          materialized
        );
      },
      updateObjects: (updates: SimulatorObjectUpdate[]) =>
        this.requireRuntime().invoke<SimulatorObjectRecord[]>(
          'updateSimulatorObjects',
          updates
        ),
      removeObjects: async (ids: string[]) => {
        await this.requireRuntime().invoke('removeSimulatorObjects', ids);
      },
      clearObjects: async () => {
        await this.requireRuntime().invoke('clearSimulatorObjects');
      },
      getObjects: (ids?: string[]) =>
        this.requireRuntime().invoke<SimulatorObjectRecord[]>(
          'getSimulatorObjects',
          ids
        ),
    };
  }

  static async open(config: XRBlocksSessionConfig) {
    const session = new XRBlocksSession(config);
    await session.start();
    return session;
  }

  get diagnostics(): BrowserDiagnostics {
    return this.runtime?.diagnostics ?? this.retainedDiagnostics;
  }

  async start(): Promise<XRBlocksSessionInfo> {
    if (this.started)
      throw new Error('XRBlocks session has already been started.');

    const signal = this.config.signal;
    signal?.throwIfAborted();
    const onAbort = () => {
      void this.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', onAbort, {once: true});
    this.removeAbortListener = () =>
      signal?.removeEventListener('abort', onAbort);

    try {
      this.retainedDiagnostics = emptyDiagnostics();
      validateSessionConfig(this.config);
      let targetUrl = this.config.url;
      let appDir: string | undefined;
      if (!targetUrl) {
        if (!this.config.appDir)
          throw new Error('Session requires --app-dir or --url.');
        this.workspace = await this.dependencies.materializeWorkspace({
          appDir: this.config.appDir,
          xrblocksRoot: this.config.xrblocksRoot,
          simulatorNavMesh: this.config.simulatorNavMesh,
        });
        signal?.throwIfAborted();
        appDir = this.config.appDir;
        this.server = await this.dependencies.serveWorkspace(
          this.workspace.rootDir
        );
        signal?.throwIfAborted();
        targetUrl = resolveAppUrl(this.server.url, this.config.entry);
      } else {
        targetUrl = appendSessionQuery(targetUrl);
      }

      this.videoRecorder = await this.dependencies.createVideoRecorder(
        this.config.recordVideo
      );
      const videoRecorder = this.videoRecorder;
      signal?.throwIfAborted();
      this.runtime = this.dependencies.createRuntime({
        url: targetUrl,
        headless: this.config.headless ?? true,
        timeoutMs: this.config.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS,
        viewport: this.config.viewport ?? {width: 1280, height: 900},
        embodiedControlOptions: {
          autoPause: true,
          realTime: this.config.realTime ?? true,
        },
        embodiedControlImport: this.config.embodiedControlImport,
        simulatorReachLimit: this.config.simulatorReachLimit,
        simulatorNavMesh: this.config.simulatorNavMesh,
        recordVideoDir: videoRecorder?.rawDir,
        recordVideoSize: this.config.recordVideo?.size,
        signal,
        onVideoStarted: videoRecorder
          ? () => videoRecorder.markVideoStarted()
          : undefined,
        onReady: videoRecorder
          ? () => videoRecorder.markSceneReady()
          : undefined,
      });

      const initResult = await this.runtime.open();
      signal?.throwIfAborted();
      this.started = true;
      if (this.config.simulatorObjects?.length) {
        await this.simulator.addObjects(this.config.simulatorObjects);
      }
      this.info = {url: targetUrl, appDir, initResult};
      return this.info;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  close() {
    this.closing ??= this.closeResources().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }

  private async closeResources() {
    this.removeAbortListener?.();
    this.removeAbortListener = undefined;
    const runtime = this.runtime;
    const videoRecorder = this.videoRecorder;
    const server = this.server;
    const workspace = this.workspace;
    if (runtime) this.retainedDiagnostics = runtime.diagnostics;
    this.runtime = undefined;
    this.videoRecorder = undefined;
    this.server = undefined;
    this.workspace = undefined;
    this.started = false;

    const errors: unknown[] = [];
    const rawVideoPath = runtime
      ? await runCleanupStep(() => runtime.close(), errors)
      : undefined;
    if (videoRecorder) {
      this.videoTimeline = await runCleanupStep(
        () => videoRecorder.finish(rawVideoPath, this.config.signal),
        errors
      );
    }
    if (server) await runCleanupStep(() => server.close(), errors);
    if (workspace) await runCleanupStep(() => workspace.cleanup(), errors);

    throwCleanupErrors(errors, 'XRBlocks session cleanup failed.');
  }

  /** @internal Shared seam for package-owned harness features. */
  invoke<T = unknown>(method: string, ...args: unknown[]) {
    return this.requireRuntime().invoke<T>(method, ...args);
  }

  observe(tool: string, args?: JsonObject) {
    return this.requireRuntime().invoke('observe', tool, args ?? {});
  }

  getCamera(
    options: JsonObject & {screenshot?: boolean; overlayOnCamera?: boolean} = {}
  ) {
    const {overlayOnCamera = true, screenshot = false, ...rest} = options;
    return this.observe(
      'getCamera',
      screenshot ? {...rest, screenshot, overlayOnCamera} : rest
    );
  }

  getHands() {
    return this.observe('getHands');
  }

  getScreenshot(options: JsonObject & {overlayOnCamera?: boolean} = {}) {
    return this.observe('getScreenshot', {
      overlayOnCamera: true,
      ...options,
    });
  }

  getSceneContext(options: SceneContextOptions): Promise<JsonObject> {
    return this.observe('getSceneContext', options) as Promise<JsonObject>;
  }

  getDevtoolsContext(options: {
    locations?: boolean;
    tags?: boolean;
    state?: boolean;
    spatial?: boolean;
    view?: boolean;
  }): Promise<JsonObject> {
    return this.requireRuntime().invoke('getDevtoolsContext', options);
  }

  async getPresetLocation(name: string): Promise<Vec3Tuple> {
    const context = await this.getDevtoolsContext({locations: true});
    const locations = context.locations as
      Record<string, {position?: unknown}> | undefined;
    const position = locations?.[name]?.position;
    if (
      !Array.isArray(position) ||
      position.length !== 3 ||
      !position.every((coordinate) => Number.isFinite(coordinate))
    ) {
      throw new Error(`Simulator preset location not found: ${name}`);
    }
    return [position[0], position[1], position[2]] as Vec3Tuple;
  }

  getSimulatorState() {
    return this.observe('getSimulatorState');
  }

  navigateTo(target: SessionTarget): Promise<SimulatorNavigationResult> {
    return this.recordAction('navigateTo', {target}, () =>
      this.requireRuntime().invoke<SimulatorNavigationResult>(
        'navigateTo',
        target
      )
    );
  }

  act(instruction: string, options: ActOptions = {}): Promise<ActResult> {
    this.requireRuntime();
    if (this.acting)
      throw new Error(
        'An agent act() call is already running for this Session.'
      );
    const runNumber = ++this.agentRunCount;
    const run = runSessionAct(this, instruction, {
      ...options,
      signal: options.signal ?? this.config.signal,
    }).then(async (result) => {
      const outDir = this.config.recordAgent?.outDir;
      if (!outDir) return result;
      const artifacts = await writeActArtifacts(result, outDir, runNumber);
      const recorded = {...result, artifacts};
      this.config.recordAgent?.onResult?.(recorded);
      return recorded;
    });
    this.acting = run;
    const clear = () => {
      if (this.acting === run) this.acting = undefined;
    };
    void run.then(clear, clear);
    return run;
  }

  teleportTo(target: unknown, options?: JsonObject) {
    return this.recordAction('teleportTo', {target, options}, () =>
      this.requireRuntime().invoke('teleportTo', target, options)
    );
  }

  stepControl(options: {durationMs?: number; control?: JsonObject}) {
    const step: JsonObject = {control: options.control ?? {}};
    if (options.durationMs !== undefined) step.durationMs = options.durationMs;
    return this.recordAction('stepControl', step, () =>
      this.requireRuntime().invoke('stepControl', step)
    );
  }

  applyControl(control: JsonObject = {}) {
    return this.recordAction('applyControl', control, () =>
      this.requireRuntime().invoke('applyControl', control)
    );
  }

  move(motion: LinearMotion) {
    const step = linearMotionStep(motion, VIEWER_MOVE_SPEED);
    return this.recordAction('move', motion, () =>
      this.requireRuntime().invoke('stepControl', {
        durationMs: step.durationMs,
        control: {locomotion: {move: step.move}},
      })
    );
  }

  rotate(rotation: EulerRotation) {
    const step = angularMotionStep(rotation);
    return this.recordAction('rotate', rotation, () =>
      this.requireRuntime().invoke('stepControl', {
        durationMs: step.durationMs,
        control: {locomotion: {rotate: step.rotate}},
      })
    );
  }

  moveHand(hand: PhysicalHand, motion: LinearMotion) {
    const normalizedHand = handIndex(hand) === 0 ? 'leftHand' : 'rightHand';
    const step = linearMotionStep(motion, HAND_MOVE_SPEED);
    return this.recordAction('moveHand', {hand, ...motion}, () =>
      this.requireRuntime().invoke('stepControl', {
        durationMs: step.durationMs,
        control: {[normalizedHand]: {move: step.move}},
      })
    );
  }

  teleportHand(hand: PhysicalHand, target: unknown) {
    return this.recordAction('teleportHand', {hand, target}, () =>
      this.requireRuntime().invoke('reachTo', handIndex(hand), target)
    );
  }

  rotateHand(hand: PhysicalHand, rotation: EulerRotation) {
    const normalizedHand = handIndex(hand) === 0 ? 'leftHand' : 'rightHand';
    const step = angularMotionStep(rotation);
    return this.recordAction('rotateHand', {hand, ...rotation}, () =>
      this.requireRuntime().invoke('stepControl', {
        durationMs: step.durationMs,
        control: {[normalizedHand]: {rotate: step.rotate}},
      })
    );
  }

  gesture(hand: PhysicalHand, pose: NamedHandPose) {
    const normalizedHand = handIndex(hand) === 0 ? 'leftHand' : 'rightHand';
    return this.recordAction('gesture', {hand, pose}, () =>
      this.requireRuntime().invoke('stepControl', {
        durationMs: HAND_POSE_TRANSITION_MS,
        control: {[normalizedHand]: {pose}},
      })
    );
  }

  setHandPose(hand: PhysicalHand, rotations: HandPoseRotations) {
    validateHandPoseRotations(rotations);
    const normalizedHand = handIndex(hand) === 0 ? 'leftHand' : 'rightHand';
    return this.recordAction('setHandPose', {hand, rotations}, () =>
      this.requireRuntime().invoke('stepControl', {
        durationMs: HAND_POSE_TRANSITION_MS,
        control: {[normalizedHand]: {rotations}},
      })
    );
  }

  startSelect(hand: PhysicalHand = 'right') {
    return this.recordAction('startSelect', {hand}, () =>
      this.requireRuntime().invoke('startSelect', handIndex(hand))
    );
  }

  endSelect(hand: PhysicalHand = 'right') {
    return this.recordAction('endSelect', {hand}, () =>
      this.requireRuntime().invoke('endSelect', handIndex(hand))
    );
  }

  lookAtTarget(target: unknown, options: AngularSpeedOptions = {}) {
    const speedDegreesPerSecond = boundedSpeed(
      options.speedDegreesPerSecond,
      ANGULAR_SPEED,
      'speedDegreesPerSecond'
    );
    return this.recordAction(
      'lookAtTarget',
      {target, speedDegreesPerSecond},
      () =>
        this.requireRuntime().invoke('lookAtTarget', target, {
          velocity: (speedDegreesPerSecond * Math.PI) / 180,
        })
    );
  }

  pointTo(
    hand: PhysicalHand = 'right',
    target?: unknown,
    options: AngularSpeedOptions = {}
  ) {
    const speedDegreesPerSecond = boundedSpeed(
      options.speedDegreesPerSecond,
      ANGULAR_SPEED,
      'speedDegreesPerSecond'
    );
    return this.recordAction(
      'pointTo',
      {hand, target, speedDegreesPerSecond},
      () =>
        this.requireRuntime().invoke('pointTo', handIndex(hand), target, {
          velocity: (speedDegreesPerSecond * Math.PI) / 180,
        })
    );
  }

  reachTo(
    hand: PhysicalHand = 'right',
    target?: unknown,
    options: LinearSpeedOptions = {}
  ) {
    const speedMetersPerSecond = boundedSpeed(
      options.speedMetersPerSecond,
      HAND_MOVE_SPEED,
      'speedMetersPerSecond'
    );
    return this.recordAction(
      'reachTo',
      {hand, target, speedMetersPerSecond},
      () =>
        this.requireRuntime().invoke('reachTo', handIndex(hand), target, {
          velocity: speedMetersPerSecond,
        })
    );
  }

  click(hand: PhysicalHand = 'right', options?: JsonObject) {
    return this.recordAction('click', {hand, options}, () =>
      this.requireRuntime().invoke('click', handIndex(hand), options)
    );
  }

  wait(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('Wait durationMs must be a positive finite number.');
    }
    return this.recordAction('wait', {durationMs}, () =>
      this.requireRuntime().invoke('wait', durationMs)
    );
  }

  stepFrame(frames = 1) {
    return this.recordAction('stepFrame', {frames}, () =>
      this.requireRuntime().invoke('stepFrame', frames)
    );
  }

  async injectAudio(input: AudioInjection): Promise<AudioInjectionResult> {
    const runtime = this.requireRuntime();
    const materialized = await this.dependencies.materializeAudio(input);
    try {
      return await this.recordAction(
        'injectAudio',
        {
          source: materialized.source,
          monitor: this.config.monitorAudio ?? false,
        },
        () =>
          runtime.injectAudio({
            source: materialized.source,
            base64: materialized.bytes.toString('base64'),
            monitor: this.config.monitorAudio ?? false,
          })
      );
    } finally {
      await materialized.cleanup();
    }
  }

  private requireRuntime() {
    if (!this.started || !this.runtime)
      throw new Error('XRBlocks session has not been started.');
    return this.runtime;
  }

  private recordAction<T>(
    name: string,
    metadata: JsonObject | undefined,
    action: () => Promise<T>
  ) {
    return this.videoRecorder?.recordAction(name, metadata, action) ?? action();
  }
}

function validateSessionConfig(config: XRBlocksSessionConfig) {
  const hasAppDir = typeof config.appDir === 'string' && config.appDir !== '';
  const hasUrl = typeof config.url === 'string' && config.url !== '';
  if (hasAppDir === hasUrl) {
    throw new Error('Session requires exactly one of appDir or url.');
  }
  if (hasUrl && config.entry !== undefined) {
    throw new Error('Session entry is only available with appDir.');
  }
  if (hasUrl && config.xrblocksRoot !== undefined) {
    throw new Error('Session xrblocksRoot is only available with appDir.');
  }
  if (
    config.embodiedControlImport !== undefined &&
    !config.embodiedControlImport.trim()
  ) {
    throw new Error('embodiedControlImport must not be empty.');
  }
  if (config.recordAgent !== undefined && !config.recordAgent.outDir.trim()) {
    throw new Error('recordAgent.outDir must not be empty.');
  }
}

function emptyDiagnostics(): BrowserDiagnostics {
  return {consoleEntries: [], pageErrors: [], networkErrors: []};
}

export function handIndex(hand: PhysicalHand | undefined | null) {
  if (hand === undefined || hand === null || hand === 'right') return 1;
  if (hand === 'left') return 0;
  throw new Error(`Hand must be "left" or "right": ${String(hand)}`);
}

function validateHandPoseRotations(rotations: HandPoseRotations) {
  const allowed = new Set<string>(HAND_POSE_JOINT_NAMES);
  for (const [joint, value] of Object.entries(rotations)) {
    if (!allowed.has(joint)) {
      throw new Error(`Unknown hand-pose joint: ${joint}.`);
    }
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some((component) => !Number.isFinite(component))
    ) {
      throw new Error(
        `Hand-pose rotation for ${joint} must be a finite [x, y, z] tuple.`
      );
    }
  }
}

export function resolveAppUrl(baseUrl: string, entry = '.') {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const appUrl = new URL('app/', root);
  const resolved = entry.startsWith('/')
    ? new URL(entry.slice(1), root)
    : new URL(entry, appUrl);
  return appendSessionQuery(resolved.href);
}

function appendSessionQuery(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.set('xrAutomation', '1');
  parsed.searchParams.set('debug', '1');
  return parsed.href;
}
