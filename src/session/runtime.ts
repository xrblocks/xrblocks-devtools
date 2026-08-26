import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
} from 'playwright';
import type {JsonObject} from '../types.js';
import {getChromiumLaunchArgs} from '../browser.js';
import {runCleanupStep, throwCleanupErrors} from '../cleanup.js';
import {serveDirectory, type RunningServer} from '../server.js';
import {
  materializeAudioInjection,
  type AudioInjection,
  type AudioInjectionResult,
} from './audio.js';
import {injectedAudioSource, injectedHarnessSource} from './injected-source.js';
import {
  createSessionRecorder,
  type RecordingArtifact,
  type SessionRecorder,
  type SessionRecordingOptions,
} from './recording.js';
import type {MaterializedAppWorkspace} from './workspace.js';
import {materializeAppWorkspace} from './workspace.js';
import {
  DEFAULT_SESSION_TIMEOUT_MS,
  type BrowserDiagnostics,
  type Viewport,
} from './types.js';

const DEFAULT_EMBODIED_CONTROL_IMPORT =
  'xrblocks/addons/embodied-control/index.js';

export type SessionRuntimeOptions = {
  target:
    {appDir: string; xrblocksRoot?: string; entry?: string} | {url: string};
  headless?: boolean;
  timeoutMs?: number;
  viewport?: Viewport;
  realTime?: boolean;
  monitorAudio?: boolean;
  simulatorReachLimit?: boolean;
  simulatorNavMesh?: boolean;
  embodiedControlImport?: string;
  recording?: SessionRecordingOptions;
  signal?: AbortSignal;
};

export type SessionRuntimeInfo = {
  url: string;
};

export type RuntimeCloseResult = {
  diagnostics: BrowserDiagnostics;
  recording?: RecordingArtifact;
};

export type SessionRuntimePort = {
  readonly diagnostics: BrowserDiagnostics;
  readonly info: SessionRuntimeInfo;
  invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  perform<T>(
    name: string,
    metadata: JsonObject | undefined,
    method: string,
    ...args: unknown[]
  ): Promise<T>;
  injectAudio(input: AudioInjection): Promise<AudioInjectionResult>;
  close(): Promise<RuntimeCloseResult>;
};

export type OpenSessionRuntime = (
  options: SessionRuntimeOptions
) => Promise<SessionRuntimePort>;

export const openSessionRuntime: OpenSessionRuntime = (options) =>
  SessionRuntime.open(options);

class SessionRuntime implements SessionRuntimePort {
  readonly diagnostics: BrowserDiagnostics = {
    consoleEntries: [],
    pageErrors: [],
    networkErrors: [],
  };
  info!: SessionRuntimeInfo;

  private workspace?: MaterializedAppWorkspace;
  private server?: RunningServer;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private recorder?: SessionRecorder;
  private closing?: Promise<RuntimeCloseResult>;
  private removeAbortListener?: () => void;

  private constructor(private readonly options: SessionRuntimeOptions) {}

  static async open(options: SessionRuntimeOptions) {
    const runtime = new SessionRuntime(options);
    try {
      await runtime.start();
      return runtime;
    } catch (error) {
      await runtime.discard().catch(() => undefined);
      throw error;
    }
  }

  private async start() {
    const signal = this.options.signal;
    signal?.throwIfAborted();
    const onAbort = () => void this.close().catch(() => undefined);
    signal?.addEventListener('abort', onAbort, {once: true});
    this.removeAbortListener = () =>
      signal?.removeEventListener('abort', onAbort);

    let targetUrl: string;
    if ('url' in this.options.target) {
      targetUrl = appendSessionQuery(this.options.target.url);
    } else {
      this.workspace = await materializeAppWorkspace({
        appDir: this.options.target.appDir,
        xrblocksRoot: this.options.target.xrblocksRoot,
        simulatorNavMesh: this.options.simulatorNavMesh,
      });
      signal?.throwIfAborted();
      this.server = await serveDirectory(this.workspace.rootDir);
      targetUrl = resolveAppUrl(this.server.url, this.options.target.entry);
    }

    this.recorder = await createSessionRecorder(this.options.recording);
    signal?.throwIfAborted();
    const {chromium} = await import('playwright');
    this.browser = await chromium.launch({
      headless: this.options.headless ?? true,
      args: getChromiumLaunchArgs(),
    });
    signal?.throwIfAborted();
    const viewport = this.options.viewport ?? {width: 800, height: 600};
    const contextOptions: Parameters<Browser['newContext']>[0] = {viewport};
    if (this.recorder?.browserVideo) {
      contextOptions.recordVideo = {
        dir: this.recorder.browserVideo.dir,
        size: this.recorder.browserVideo.size ?? viewport,
      };
    }
    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    this.recorder?.videoStarted();
    this.page.setDefaultTimeout(
      this.options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS
    );
    this.page.on('console', (message) => this.onConsole(message));
    this.page.on('pageerror', (error) => this.onPageError(error));
    this.page.on('requestfailed', (request) => this.onRequestFailed(request));
    await this.page.addInitScript({content: await injectedAudioSource()});
    await this.page.goto(targetUrl, {waitUntil: 'domcontentloaded'});
    signal?.throwIfAborted();
    await this.page.waitForFunction(() =>
      Boolean(globalThis.window?.xb && globalThis.window?.xbReady)
    );
    await this.page.evaluate(await injectedHarnessSource());
    await this.evaluateHarness('init', {
      embodiedControlImport:
        this.options.embodiedControlImport ?? DEFAULT_EMBODIED_CONTROL_IMPORT,
      embodiedControlOptions: {
        autoPause: true,
        realTime: this.options.realTime ?? true,
      },
      simulatorReachLimit: this.options.simulatorReachLimit,
      simulatorNavMesh: this.options.simulatorNavMesh,
    });
    await this.evaluateHarness('ready');
    signal?.throwIfAborted();
    this.recorder?.sceneReady();
    this.info = {url: targetUrl};
  }

  invoke<T = unknown>(method: string, ...args: unknown[]) {
    return this.evaluateHarness<T>(method, ...args);
  }

  perform<T>(
    name: string,
    metadata: JsonObject | undefined,
    method: string,
    ...args: unknown[]
  ) {
    const action = () => this.evaluateHarness<T>(method, ...args);
    return (
      this.recorder?.perform(name, metadata, action, () =>
        this.capturePage()
      ) ?? action()
    );
  }

  async injectAudio(input: AudioInjection): Promise<AudioInjectionResult> {
    const materialized = await materializeAudioInjection(input);
    try {
      const action = () =>
        this.requirePage().evaluate(
          async (args) => {
            const audio = globalThis.window.__xrblocksSyntheticAudio;
            if (!audio?.available)
              throw new Error('Synthetic microphone audio is unavailable.');
            return audio.inject(args) as Promise<AudioInjectionResult>;
          },
          {
            source: materialized.source,
            base64: materialized.bytes.toString('base64'),
            monitor: this.options.monitorAudio ?? false,
          }
        );
      return await (this.recorder?.perform(
        'injectAudio',
        {
          source: materialized.source,
          monitor: this.options.monitorAudio ?? false,
        },
        action,
        () => this.capturePage()
      ) ?? action());
    } finally {
      await materialized.cleanup();
    }
  }

  close() {
    return (this.closing ??= this.closeResources());
  }

  private async closeResources(): Promise<RuntimeCloseResult> {
    this.removeAbortListener?.();
    this.removeAbortListener = undefined;
    const page = this.page;
    const context = this.context;
    const browser = this.browser;
    const recorder = this.recorder;
    const server = this.server;
    const workspace = this.workspace;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.recorder = undefined;
    this.server = undefined;
    this.workspace = undefined;

    const errors: unknown[] = [];
    if (page && recorder)
      await runCleanupStep(
        () => recorder.beforeClose(() => page.screenshot({type: 'png'})),
        errors
      );
    const video = page?.video();
    if (context) await runCleanupStep(() => context.close(), errors);
    const rawVideoPath = video
      ? await runCleanupStep(() => video.path(), errors)
      : undefined;
    const recording = recorder
      ? await runCleanupStep(
          () => recorder.finish(rawVideoPath, this.options.signal),
          errors
        )
      : undefined;
    if (browser) await runCleanupStep(() => browser.close(), errors);
    if (server) await runCleanupStep(() => server.close(), errors);
    if (workspace) await runCleanupStep(() => workspace.cleanup(), errors);
    throwCleanupErrors(errors, 'XRBlocks Session cleanup failed.');
    return {diagnostics: this.diagnostics, recording};
  }

  private async discard() {
    this.removeAbortListener?.();
    this.removeAbortListener = undefined;
    const errors: unknown[] = [];
    if (this.context) await runCleanupStep(() => this.context!.close(), errors);
    if (this.recorder)
      await runCleanupStep(() => this.recorder!.discard(), errors);
    if (this.browser) await runCleanupStep(() => this.browser!.close(), errors);
    if (this.server) await runCleanupStep(() => this.server!.close(), errors);
    if (this.workspace)
      await runCleanupStep(() => this.workspace!.cleanup(), errors);
  }

  private capturePage() {
    return this.requirePage().screenshot({type: 'png'});
  }

  private evaluateHarness<T = unknown>(method: string, ...args: unknown[]) {
    return this.requirePage().evaluate(
      ({methodName, methodArgs}) => {
        const harness = globalThis.window.__xrblocksDevtoolsRuntime;
        const fn = harness?.[methodName];
        if (typeof fn !== 'function')
          throw new Error(`XR Blocks harness method not found: ${methodName}`);
        return fn.apply(harness, methodArgs);
      },
      {methodName: method, methodArgs: args}
    ) as Promise<T>;
  }

  private requirePage() {
    if (!this.page) throw new Error('XRBlocks Session is not open.');
    return this.page;
  }

  private onConsole(message: ConsoleMessage) {
    const level = message.type();
    if (level === 'debug' || level === 'log' || level === 'info') return;
    this.diagnostics.consoleEntries.push({
      level,
      text: message.text(),
      location: message.location(),
      timestamp: new Date().toISOString(),
    });
  }

  private onPageError(error: Error) {
    this.diagnostics.pageErrors.push({
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }

  private onRequestFailed(request: Request) {
    this.diagnostics.networkErrors.push({
      url: request.url(),
      method: request.method(),
      failureText: request.failure()?.errorText,
      timestamp: new Date().toISOString(),
    });
  }
}

function resolveAppUrl(baseUrl: string, entry = '.') {
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

declare global {
  interface Window {
    xb?: {core?: unknown};
    xbReady?: Promise<void>;
    __xrblocksDevtoolsRuntime?: Record<string, unknown>;
    __xrblocksDevtoolsEmbodiedControl?: Record<string, unknown>;
    __xrblocksSyntheticAudio?: {
      available: boolean;
      inject(input: JsonObject): Promise<unknown>;
    };
  }
}
