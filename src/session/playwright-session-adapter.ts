import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
} from 'playwright';
import type {JsonObject} from '../types.js';
import {
  DEFAULT_SESSION_TIMEOUT_MS,
  type BrowserDiagnostics,
  type Viewport,
} from './types.js';
import type {AudioInjectionResult} from './audio.js';
import {injectedAudioSource, injectedHarnessSource} from './injected-source.js';
import {runCleanupStep, throwCleanupErrors} from '../cleanup.js';
import {getChromiumLaunchArgs} from '../browser.js';

export const DEFAULT_EMBODIED_CONTROL_IMPORT =
  'xrblocks/addons/embodied-control/index.js';

export type PlaywrightSessionOptions = {
  url: string;
  headless?: boolean;
  timeoutMs?: number;
  viewport?: Viewport;
  embodiedControlImport?: string | null;
  embodiedControlOptions?: JsonObject;
  simulatorReachLimit?: boolean;
  simulatorNavMesh?: boolean;
  recordVideoDir?: string;
  onVideoStarted?: () => void;
  onReady?: () => void;
  signal?: AbortSignal;
};

export class PlaywrightSessionAdapter {
  readonly diagnostics: BrowserDiagnostics = {
    consoleEntries: [],
    pageErrors: [],
    networkErrors: [],
  };

  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private closing?: Promise<string | undefined>;
  private removeAbortListener?: () => void;

  constructor(private readonly options: PlaywrightSessionOptions) {}

  async open() {
    const signal = this.options.signal;
    signal?.throwIfAborted();
    const onAbort = () => {
      void this.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', onAbort, {once: true});
    this.removeAbortListener = () =>
      signal?.removeEventListener('abort', onAbort);

    try {
      const {chromium} = await import('playwright');
      signal?.throwIfAborted();
      this.browser = await chromium.launch({
        headless: this.options.headless ?? true,
        args: getChromiumLaunchArgs(),
      });
      signal?.throwIfAborted();
      const contextOptions: Parameters<Browser['newContext']>[0] = {
        viewport: this.options.viewport ?? {width: 1280, height: 900},
      };
      if (this.options.recordVideoDir) {
        contextOptions.recordVideo = {
          dir: this.options.recordVideoDir,
          size: contextOptions.viewport ?? undefined,
        };
      }
      this.context = await this.browser.newContext(contextOptions);
      signal?.throwIfAborted();
      this.page = await this.context.newPage();
      this.options.onVideoStarted?.();
      signal?.throwIfAborted();
      this.page.setDefaultTimeout(
        this.options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS
      );
      this.page.on('console', (message) => this.onConsole(message));
      this.page.on('pageerror', (error) => this.onPageError(error));
      this.page.on('requestfailed', (request) => this.onRequestFailed(request));
      await this.page.addInitScript({content: await injectedAudioSource()});
      await this.page.goto(this.options.url, {waitUntil: 'domcontentloaded'});
      signal?.throwIfAborted();
      await this.page.waitForFunction(() =>
        Boolean(globalThis.window?.xb && globalThis.window?.xbReady)
      );
      signal?.throwIfAborted();
      await this.page.evaluate(await injectedHarnessSource());
      const init = await this.evaluateHarness('init', {
        embodiedControlImport:
          this.options.embodiedControlImport ?? DEFAULT_EMBODIED_CONTROL_IMPORT,
        embodiedControlOptions: this.options.embodiedControlOptions ?? {},
        simulatorReachLimit: this.options.simulatorReachLimit,
        simulatorNavMesh: this.options.simulatorNavMesh,
      });
      signal?.throwIfAborted();
      const ready = await this.evaluateHarness('ready');
      signal?.throwIfAborted();
      this.options.onReady?.();
      return {init, ready};
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
    const page = this.page;
    const context = this.context;
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;

    const errors: unknown[] = [];
    const video = page?.video();
    if (context) await runCleanupStep(() => context.close(), errors);
    const rawVideoPath = video
      ? await runCleanupStep(() => video.path(), errors)
      : undefined;
    if (browser) await runCleanupStep(() => browser.close(), errors);
    throwCleanupErrors(errors, 'Playwright Session adapter cleanup failed.');
    return rawVideoPath;
  }

  invoke<T = unknown>(method: string, ...args: unknown[]) {
    return this.evaluateHarness<T>(method, ...args);
  }

  injectAudio(args: JsonObject): Promise<AudioInjectionResult> {
    return this.requirePage().evaluate(async (input) => {
      const audio = globalThis.window.__xrblocksSyntheticAudio;
      if (!audio?.available) {
        throw new Error('Synthetic microphone audio is unavailable.');
      }
      return audio.inject(input) as Promise<AudioInjectionResult>;
    }, args);
  }

  private async evaluateHarness<T = unknown>(
    method: string,
    ...args: unknown[]
  ) {
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
    if (!this.page) throw new Error('Playwright page has not been opened.');
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
