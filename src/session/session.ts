import {runSessionAct, type ActOptions, type ActResult} from '../agent.js';
import {writeActArtifacts, type ActArtifacts} from '../agent-artifacts.js';
import type {RecordingArtifact, SessionRecordingOptions} from './recording.js';
import {
  openSessionRuntime,
  type OpenSessionRuntime,
  type SessionRuntimePort,
} from './runtime.js';
import {
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
import type {
  AudioConsumerState,
  AudioInjection,
  AudioInjectionResult,
  WaitForAudioConsumerOptions,
} from './audio.js';
import {materializeSimulatorObjectInputs} from './simulator-objects.js';
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
  recording?: SessionRecordingOptions;
  /** Record each act() trajectory and its observation images. */
  recordAgent?: {
    outDir: string;
  };
  signal?: AbortSignal;
};

export type XRBlocksSessionInfo = {url: string};

export type SessionCloseResult = {
  diagnostics: BrowserDiagnostics;
  recording?: RecordingArtifact;
  agentRuns: Array<{status: ActResult['status']; artifacts: ActArtifacts}>;
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
  private runtime?: SessionRuntimePort;
  private retainedDiagnostics: BrowserDiagnostics = emptyDiagnostics();
  private started = false;
  private closing?: Promise<SessionCloseResult>;
  private removeAbortListener?: () => void;
  private acting?: Promise<ActResult>;
  private agentRunCount = 0;
  private readonly agentArtifacts: SessionCloseResult['agentRuns'] = [];

  private readonly openRuntime: OpenSessionRuntime;

  constructor(config: XRBlocksSessionConfig);
  /** @internal */
  constructor(config: XRBlocksSessionConfig, openRuntime: OpenSessionRuntime);
  constructor(
    config: XRBlocksSessionConfig,
    openRuntime: OpenSessionRuntime = openSessionRuntime
  ) {
    this.config = config;
    this.openRuntime = openRuntime;
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
    if (this.started || this.closing)
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
      const target = this.config.url
        ? {url: this.config.url}
        : {
            appDir: this.config.appDir!,
            xrblocksRoot: this.config.xrblocksRoot,
            entry: this.config.entry,
          };
      this.runtime = await this.openRuntime({
        target,
        headless: this.config.headless,
        timeoutMs: this.config.timeoutMs,
        viewport: this.config.viewport,
        realTime: this.config.realTime,
        monitorAudio: this.config.monitorAudio,
        embodiedControlImport: this.config.embodiedControlImport,
        simulatorReachLimit: this.config.simulatorReachLimit,
        simulatorNavMesh: this.config.simulatorNavMesh,
        recording: this.config.recording,
        signal,
      });
      signal?.throwIfAborted();
      this.started = true;
      if (this.config.simulatorObjects?.length) {
        await this.simulator.addObjects(this.config.simulatorObjects);
      }
      this.info = this.runtime.info;
      return this.info;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  close() {
    return (this.closing ??= this.closeResources());
  }

  private async closeResources(): Promise<SessionCloseResult> {
    this.removeAbortListener?.();
    this.removeAbortListener = undefined;
    const runtime = this.runtime;
    if (runtime) this.retainedDiagnostics = runtime.diagnostics;
    this.runtime = undefined;
    this.started = false;
    const runtimeResult = runtime
      ? await runtime.close()
      : {diagnostics: this.retainedDiagnostics};
    this.retainedDiagnostics = runtimeResult.diagnostics;
    return {
      ...runtimeResult,
      agentRuns: [...this.agentArtifacts],
    };
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
    return this.requireRuntime().perform<SimulatorNavigationResult>(
      'navigateTo',
      {target},
      'navigateTo',
      target
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
      this.agentArtifacts.push({status: result.status, artifacts});
      const recorded = {...result, artifacts};
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
    return this.requireRuntime().perform(
      'teleportTo',
      {target, options},
      'teleportTo',
      target,
      options
    );
  }

  stepControl(options: {durationMs?: number; control?: JsonObject}) {
    const step: JsonObject = {control: options.control ?? {}};
    if (options.durationMs !== undefined) step.durationMs = options.durationMs;
    return this.requireRuntime().perform(
      'stepControl',
      step,
      'stepControl',
      step
    );
  }

  applyControl(control: JsonObject = {}) {
    return this.requireRuntime().perform(
      'applyControl',
      control,
      'applyControl',
      control
    );
  }

  move(motion: LinearMotion) {
    const step = linearMotionStep(motion, VIEWER_MOVE_SPEED);
    return this.requireRuntime().perform('move', motion, 'stepControl', {
      durationMs: step.durationMs,
      control: {locomotion: {move: step.move}},
    });
  }

  rotate(rotation: EulerRotation) {
    const step = angularMotionStep(rotation);
    return this.requireRuntime().perform('rotate', rotation, 'stepControl', {
      durationMs: step.durationMs,
      control: {locomotion: {rotate: step.rotate}},
    });
  }

  moveHand(hand: PhysicalHand, motion: LinearMotion) {
    const normalizedHand = controlHand(hand);
    const step = linearMotionStep(motion, HAND_MOVE_SPEED);
    return this.requireRuntime().perform(
      'moveHand',
      {hand, ...motion},
      'stepControl',
      {
        durationMs: step.durationMs,
        control: {[normalizedHand]: {move: step.move}},
      }
    );
  }

  teleportHand(
    hand: PhysicalHand,
    target: unknown,
    options: Pick<LinearSpeedOptions, 'anchor'> = {}
  ) {
    return this.requireRuntime().perform(
      'teleportHand',
      {hand, target, ...options},
      'reachTo',
      handIndex(hand),
      target,
      options
    );
  }

  rotateHand(hand: PhysicalHand, rotation: EulerRotation) {
    const normalizedHand = controlHand(hand);
    const step = angularMotionStep(rotation);
    return this.requireRuntime().perform(
      'rotateHand',
      {hand, ...rotation},
      'stepControl',
      {
        durationMs: step.durationMs,
        control: {[normalizedHand]: {rotate: step.rotate}},
      }
    );
  }

  gesture(hand: PhysicalHand, pose: NamedHandPose) {
    const normalizedHand = controlHand(hand);
    return this.requireRuntime().perform(
      'gesture',
      {hand, pose},
      'stepControl',
      {
        durationMs: HAND_POSE_TRANSITION_MS,
        control: {[normalizedHand]: {pose}},
      }
    );
  }

  setHandPose(hand: PhysicalHand, rotations: HandPoseRotations) {
    validateHandPoseRotations(rotations);
    const normalizedHand = controlHand(hand);
    return this.requireRuntime().perform(
      'setHandPose',
      {hand, rotations},
      'stepControl',
      {
        durationMs: HAND_POSE_TRANSITION_MS,
        control: {[normalizedHand]: {rotations}},
      }
    );
  }

  startSelect(hand: PhysicalHand = 'right') {
    return this.requireRuntime().perform(
      'startSelect',
      {hand},
      'startSelect',
      handIndex(hand)
    );
  }

  endSelect(hand: PhysicalHand = 'right') {
    return this.requireRuntime().perform(
      'endSelect',
      {hand},
      'endSelect',
      handIndex(hand)
    );
  }

  lookAtTarget(target: unknown, options: AngularSpeedOptions = {}) {
    const speedDegreesPerSecond = boundedSpeed(
      options.speedDegreesPerSecond,
      ANGULAR_SPEED,
      'speedDegreesPerSecond'
    );
    return this.requireRuntime().perform(
      'lookAtTarget',
      {target, speedDegreesPerSecond},
      'lookAtTarget',
      target,
      {velocity: (speedDegreesPerSecond * Math.PI) / 180}
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
    return this.requireRuntime().perform(
      'pointTo',
      {hand, target, speedDegreesPerSecond},
      'pointTo',
      handIndex(hand),
      target,
      {velocity: (speedDegreesPerSecond * Math.PI) / 180}
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
    return this.requireRuntime().perform(
      'reachTo',
      {hand, target, speedMetersPerSecond, anchor: options.anchor},
      'reachTo',
      handIndex(hand),
      target,
      {velocity: speedMetersPerSecond, anchor: options.anchor}
    );
  }

  click(hand: PhysicalHand = 'right', options?: JsonObject) {
    return this.requireRuntime().perform(
      'click',
      {hand, options},
      'click',
      handIndex(hand),
      options
    );
  }

  rayClick(hand: PhysicalHand, target: unknown) {
    return this.requireRuntime().perform(
      'rayClick',
      {hand, target},
      'rayClick',
      handIndex(hand),
      target
    );
  }

  wait(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('Wait durationMs must be a positive finite number.');
    }
    return this.requireRuntime().perform(
      'wait',
      {durationMs},
      'wait',
      durationMs
    );
  }

  stepFrame(frames = 1) {
    return this.requireRuntime().perform(
      'stepFrame',
      {frames},
      'stepFrame',
      frames
    );
  }

  injectAudio(input: AudioInjection): Promise<AudioInjectionResult> {
    return this.requireRuntime().injectAudio(input);
  }

  waitForAudioConsumer(
    options?: WaitForAudioConsumerOptions
  ): Promise<AudioConsumerState> {
    return this.requireRuntime().waitForAudioConsumer(options);
  }

  private requireRuntime() {
    if (!this.started || !this.runtime)
      throw new Error('XRBlocks session has not been started.');
    return this.runtime;
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
  if (config.recording !== undefined && !config.recording.out.trim()) {
    throw new Error('recording.out must not be empty.');
  }
}

function emptyDiagnostics(): BrowserDiagnostics {
  return {consoleEntries: [], pageErrors: [], networkErrors: []};
}

function handIndex(hand: PhysicalHand | undefined | null) {
  if (hand === undefined || hand === null || hand === 'right') return 1;
  if (hand === 'left') return 0;
  throw new Error(`Hand must be "left" or "right": ${String(hand)}`);
}

function controlHand(hand: PhysicalHand) {
  return handIndex(hand) === 0 ? 'leftHand' : 'rightHand';
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
