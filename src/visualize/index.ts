import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium, type Browser, type Page} from 'playwright';
import {bundlePreviewEntry} from './bundle.js';
import {previewHtml} from './html.js';
import {normalizePreviewInput} from './input.js';
import {prepareHandPreview, validateHandPreview} from './hand.js';
import {resolvePreviewRuntime} from './runtime.js';
import type {VisualizeRequest, VisualizeResult} from './types.js';
import {runCleanupStep, throwCleanupErrors} from '../cleanup.js';
import {getChromiumLaunchArgs} from '../browser.js';
import {symlinkDir} from '../fs-utils.js';
import {serveDirectory, type RunningServer} from '../server.js';

export async function visualize(
  options: VisualizeRequest
): Promise<VisualizeResult> {
  options.signal?.throwIfAborted();
  const size = parseSize(options.size ?? defaultSize(options.kind));
  const background = options.background ?? '#f4f5f7';
  if (options.kind === 'hand') validateHandPreview(options);
  const input =
    options.kind === 'hand'
      ? await prepareHandPreview(options.signal)
      : await normalizePreviewInput(options.input, options.assetsDir);
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), 'xrblocks-visualize-')
  ).catch(async (error) => {
    await input.cleanup?.();
    throw error;
  });
  let server: RunningServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let closing = Promise.resolve();
  const closeRuntime = () => {
    closing = closing.then(async () => {
      const activePage = page;
      const activeBrowser = browser;
      const activeServer = server;
      page = undefined;
      browser = undefined;
      server = undefined;
      const errors: unknown[] = [];
      if (activePage) {
        await runCleanupStep(() => disposePreviewPage(activePage), errors);
        await runCleanupStep(() => activePage.close(), errors);
      }
      if (activeBrowser)
        await runCleanupStep(() => activeBrowser.close(), errors);
      if (activeServer)
        await runCleanupStep(() => activeServer.close(), errors);
      throwCleanupErrors(errors, 'Preview runtime cleanup failed.');
    });
    return closing;
  };
  const onAbort = () => void closeRuntime().catch(() => undefined);
  options.signal?.addEventListener('abort', onAbort, {once: true});
  try {
    const runtime = await resolvePreviewRuntime(
      options.kind !== 'model' ? options.xrblocksRoot : undefined
    );
    await mkdir(path.join(tempDir, 'runtime'), {recursive: true});
    await symlinkDir(runtime.threeDir, path.join(tempDir, 'runtime', 'three'));
    await symlinkDir(input.assetsDir, path.join(tempDir, 'assets'));
    const entryJs = path.join(tempDir, 'entry.js');
    await bundlePreviewEntry({
      kind: options.kind,
      previewPath: input.modulePath,
      xrblocksEntry: runtime.xrblocksEntry,
      outfile: entryJs,
    });
    await writeFile(
      path.join(tempDir, 'index.html'),
      previewHtml({
        width: size.width,
        height: size.height,
        background,
        views:
          options.kind === 'ui' ? 'front' : (options.views ?? 'inspection-4'),
        hand:
          options.kind === 'hand'
            ? {
                pose: options.pose,
                rotations: options.rotations,
                hand: options.hand,
              }
            : undefined,
      }),
      'utf8'
    );
    options.signal?.throwIfAborted();
    server = await serveDirectory(tempDir);
    options.signal?.throwIfAborted();
    browser = await chromium.launch({
      headless: true,
      args: getChromiumLaunchArgs(),
    });
    options.signal?.throwIfAborted();
    page = await browser.newPage({viewport: size});
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => {
      browserErrors.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`
      );
    });
    options.signal?.throwIfAborted();
    await page.goto(server.url, {waitUntil: 'domcontentloaded'});
    options.signal?.throwIfAborted();
    try {
      await page.waitForFunction(
        () => {
          const visualizer = window.__xrblocksVisualizer;
          if (visualizer?.error) throw new Error(visualizer.error);
          return Boolean(visualizer?.ready);
        },
        undefined,
        {timeout: options.kind === 'ui' ? 120_000 : 30_000}
      );
    } catch (error) {
      if (browserErrors.length === 0) throw error;
      throw new Error(browserErrors.join('\n'), {cause: error});
    }
    options.signal?.throwIfAborted();
    const warnings = await page.evaluate(
      () => window.__xrblocksVisualizer?.warnings ?? []
    );
    await mkdir(path.dirname(path.resolve(options.out)), {recursive: true});
    await page.screenshot({
      path: path.resolve(options.out),
      omitBackground: background === 'transparent',
    });
    return {out: path.resolve(options.out), warnings};
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    const errors: unknown[] = [];
    await runCleanupStep(closeRuntime, errors);
    if (input.cleanup) await runCleanupStep(() => input.cleanup!(), errors);
    await runCleanupStep(
      () => rm(tempDir, {recursive: true, force: true}),
      errors
    );
    throwCleanupErrors(errors, 'Preview cleanup failed.');
  }
}

async function disposePreviewPage(page: Page) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      page.evaluate(() => window.__xrblocksVisualizer?.dispose?.()),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 1_000);
      }),
    ]);
  } catch {
    // Cancellation can close the page before its runtime disposes.
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function defaultSize(kind: string) {
  return kind === 'ui' ? '1024x768' : '1024x1024';
}

function parseSize(value: string) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid --size value: ${value}`);
  return {width: Number(match[1]), height: Number(match[2])};
}
