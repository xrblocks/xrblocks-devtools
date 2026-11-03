import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser} from 'playwright';
import {getChromiumLaunchArgs} from '../browser.js';
import {runCleanupStep, throwCleanupErrors} from '../cleanup.js';
import {requireFile, symlinkDir} from '../fs-utils.js';
import {serveDirectory, type RunningServer} from '../server.js';
import {bundleBrowserEntry} from '../visualize/bundle.js';
import {previewHtml} from '../visualize/html.js';
import {normalizePreviewInput} from '../visualize/input.js';
import {resolvePreviewRuntime} from '../visualize/runtime.js';
import {augmentPose, randomGenerator} from './augment.js';
import {inspectHandPosesSchema, testGestureDetectorSchema} from './schema.js';
import type {
  HeuristicPose,
  InspectHandPosesRequest,
  TestGestureDetectorRequest,
} from './schema.js';
import type {HandPoseCase, inspect, test} from './browser/heuristics.js';

async function poseCases(
  poses: HeuristicPose[],
  augmentation: ReturnType<
    typeof testGestureDetectorSchema.parse
  >['augmentation'],
  signal?: AbortSignal
) {
  const ids = poses.map((pose, index) => pose.id ?? `pose-${index}`);
  if (new Set(ids).size !== ids.length)
    throw new Error('Pose IDs must be unique.');
  const settings = augmentation ?? {
    seed: 42,
    samplesPerPose: 1,
    angleStddevRadians: 0,
    keypointStddevMeters: 0,
  };
  const random = randomGenerator(settings.seed);
  const cases: HandPoseCase[] = [];
  const warnings: string[] = [];
  for (const [index, pose] of poses.entries()) {
    const generated = augmentPose(
      pose,
      {...settings, constrain: Boolean(augmentation)},
      random
    );
    if (generated.adjusted)
      warnings.push(
        `Applied anatomical limits to ${ids[index]}. Review its expected labels.`
      );
    for (const {hand, sample, points} of generated.samples) {
      signal?.throwIfAborted();
      cases.push({
        id: ids[index],
        hand,
        sample,
        points: points.map((point) => point.toArray()),
        ...(pose.expected === undefined ? {} : {expected: pose.expected}),
      });
      if (cases.length % 100 === 0)
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return {cases, warnings};
}

async function runBrowser(
  options: {
    input?: TestGestureDetectorRequest['input'];
    xrblocksRoot?: string;
  },
  payload:
    | {kind: 'inspect'; cases: HandPoseCase[]}
    | {
        kind: 'test';
        cases: HandPoseCase[];
        minimumConfidence: number;
        configurations: Record<string, {enabled: boolean; threshold?: number}>;
      },
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const input = await normalizePreviewInput(
    options.input ?? {source: 'export const detectors = {};'}
  );
  let directory: string | undefined;
  let browser: Browser | undefined;
  let server: RunningServer | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing = Promise.resolve();
  const closeRuntime = () =>
    (closing = closing.then(async () => {
      const activeBrowser = browser,
        activeServer = server;
      browser = undefined;
      server = undefined;
      const errors: unknown[] = [];
      if (activeBrowser)
        await runCleanupStep(() => activeBrowser.close(), errors);
      if (activeServer)
        await runCleanupStep(() => activeServer.close(), errors);
      throwCleanupErrors(errors, 'Heuristic runtime cleanup failed.');
    }));
  const onAbort = () => void closeRuntime().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, {once: true});
  try {
    await requireFile(input.modulePath, 'Detector module');
    if ((await stat(input.modulePath)).size > 100000)
      throw new Error('Detector module must be under 100 KB.');
    directory = await mkdtemp(path.join(os.tmpdir(), 'xrblocks-heuristics-'));
    const runtime = await resolvePreviewRuntime(true, options.xrblocksRoot);
    await mkdir(path.join(directory, 'runtime'), {recursive: true});
    await symlinkDir(
      runtime.threeDir,
      path.join(directory, 'runtime', 'three')
    );
    await bundleBrowserEntry({
      entryPath: fileURLToPath(
        new URL('./browser/heuristics.js', import.meta.url)
      ),
      modulePath: input.modulePath,
      xrblocksEntry: runtime.xrblocksEntry,
      outfile: path.join(directory, 'entry.js'),
    });
    await writeFile(
      path.join(directory, 'index.html'),
      previewHtml({width: 1, height: 1, background: '#fff', views: 'front'})
    );
    signal?.throwIfAborted();
    server = await serveDirectory(directory);
    signal?.throwIfAborted();
    browser = await chromium.launch({
      headless: true,
      args: getChromiumLaunchArgs(),
    });
    signal?.throwIfAborted();
    const page = await browser.newPage();
    await page.goto(server.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    signal?.throwIfAborted();
    const result = await Promise.race([
      page.evaluate(async (payload) => {
        const entry = './entry.js';
        const api = await import(entry);
        return payload.kind === 'inspect'
          ? api.inspect(payload.cases)
          : api.test(payload);
      }, payload),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Heuristic evaluation exceeded 30 seconds.')),
          30000
        );
      }),
    ]);
    signal?.throwIfAborted();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    const errors: unknown[] = [];
    await runCleanupStep(closeRuntime, errors);
    if (input.cleanup) await runCleanupStep(input.cleanup, errors);
    if (directory)
      await runCleanupStep(
        () => rm(directory!, {recursive: true, force: true}),
        errors
      );
    throwCleanupErrors(errors, 'Heuristic cleanup failed.');
  }
}

export async function inspectHandPoses(
  input: InspectHandPosesRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const options = inspectHandPosesSchema.parse(input);
  const {cases} = await poseCases(options.poses, undefined, signal);
  return (await runBrowser(
    options,
    {kind: 'inspect', cases},
    signal
  )) as ReturnType<typeof inspect>;
}

export async function testGestureDetector(
  input: TestGestureDetectorRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const options = testGestureDetectorSchema.parse(input);
  const {cases, warnings} = await poseCases(
    options.poses,
    options.augmentation,
    signal
  );
  const result = (await runBrowser(
    options,
    {
      kind: 'test',
      cases,
      minimumConfidence: options.minimumConfidence,
      configurations: options.configurations,
    },
    signal
  )) as ReturnType<typeof test>;
  return {...result, augmentation: options.augmentation ?? null, warnings};
}
