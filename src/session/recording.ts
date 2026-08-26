import {access, cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import type {JsonObject} from '../types.js';
import type {Viewport} from './types.js';

const execFileAsync = promisify(execFile);

export type VideoRecordingOptions = {
  mode: 'video';
  out: string;
  size?: Viewport;
  scope?: 'actions' | 'scene' | 'full';
  keepRaw?: boolean;
  paddingMs?: number;
};

export type CheckpointRecordingOptions = {
  mode: 'checkpoints';
  out: string;
};

export type SessionRecordingOptions =
  VideoRecordingOptions | CheckpointRecordingOptions;

type SessionActionRecord = {
  name: string;
  startMs: number;
  endMs: number;
  metadata?: JsonObject;
};

export type RecordingArtifact = {
  mode: 'video' | 'checkpoints';
  videoPath: string;
  manifestPath: string;
};

type Segment = {startMs: number; endMs: number};
type CapturePage = () => Promise<Buffer>;

export type SessionRecorder = {
  readonly browserVideo?: {dir: string; size?: Viewport};
  videoStarted(): void;
  sceneReady(): void;
  perform<T>(
    name: string,
    metadata: JsonObject | undefined,
    action: () => Promise<T>,
    capture: CapturePage
  ): Promise<T>;
  beforeClose(capture: CapturePage): Promise<void>;
  finish(
    rawVideoPath: string | undefined,
    signal?: AbortSignal
  ): Promise<RecordingArtifact>;
  discard(): Promise<void>;
};

export async function createSessionRecorder(
  options?: SessionRecordingOptions,
  clock: () => number = () => performance.now()
): Promise<SessionRecorder | undefined> {
  if (!options) return undefined;
  return options.mode === 'checkpoints'
    ? CheckpointRecorder.create(options, clock)
    : VideoRecorder.create(options, clock);
}

type NormalizedVideoOptions = {
  out: string;
  manifestOut: string;
  scope: 'actions' | 'scene' | 'full';
  keepRaw: boolean;
  paddingMs: number;
  size?: Viewport;
};

class VideoRecorder implements SessionRecorder {
  readonly browserVideo: {dir: string; size?: Viewport};
  private readonly actions: SessionActionRecord[] = [];
  private startTimeMs: number;
  private sceneReadyOffsetMs = 0;

  private constructor(
    private readonly options: NormalizedVideoOptions,
    rawDir: string,
    private readonly clock: () => number
  ) {
    this.browserVideo = {dir: rawDir, size: options.size};
    this.startTimeMs = clock();
  }

  static async create(input: VideoRecordingOptions, clock: () => number) {
    const options = normalizeVideoOptions(input);
    const rawDir = await mkdtemp(path.join(os.tmpdir(), 'xrblocks-video-'));
    return new VideoRecorder(options, rawDir, clock);
  }

  videoStarted() {
    this.startTimeMs = this.clock();
    this.sceneReadyOffsetMs = 0;
  }

  sceneReady() {
    this.sceneReadyOffsetMs = this.elapsedMs();
  }

  async perform<T>(
    name: string,
    metadata: JsonObject | undefined,
    action: () => Promise<T>
  ): Promise<T> {
    const startMs = this.elapsedMs();
    try {
      return await action();
    } finally {
      this.actions.push({
        name,
        startMs,
        endMs: Math.max(startMs, this.elapsedMs()),
        metadata,
      });
    }
  }

  async beforeClose() {}

  discard() {
    return rm(this.browserVideo.dir, {recursive: true, force: true});
  }

  async finish(rawVideoPath: string | undefined, signal?: AbortSignal) {
    try {
      if (!rawVideoPath)
        throw new Error('Playwright did not produce a Session video.');

      const rawOut = `${withoutExtension(this.options.out)}.raw.webm`;
      let videoPath = this.options.out;
      let retainedRawPath: string | null = rawVideoPath;
      let trimmed = false;
      let trimSkippedReason: string | null = null;
      await mkdir(path.dirname(this.options.out), {recursive: true});
      await mkdir(path.dirname(this.options.manifestOut), {recursive: true});

      if (this.options.scope === 'scene') {
        const ffmpeg = await requireFfmpeg();
        signal?.throwIfAborted();
        await transcodeFullVideo(
          ffmpeg,
          rawVideoPath,
          this.options.out,
          this.sceneReadyOffsetMs,
          signal
        );
        retainedRawPath = this.options.keepRaw
          ? await copyRaw(rawVideoPath, rawOut)
          : null;
        trimSkippedReason = 'recording starts at scene readiness';
      } else if (this.options.scope === 'full') {
        await cp(rawVideoPath, this.options.out);
        retainedRawPath = this.options.out;
        trimSkippedReason = 'trimming disabled';
      } else if (signal?.aborted) {
        retainedRawPath = await copyRaw(rawVideoPath, rawOut);
        videoPath = retainedRawPath;
        trimSkippedReason = 'session interrupted';
      } else {
        const segments = mergeSegments(this.actions, this.options.paddingMs);
        const ffmpeg = await findExecutable('ffmpeg');
        if (segments.length === 0 || !ffmpeg) {
          retainedRawPath = await copyRaw(rawVideoPath, rawOut);
          videoPath = retainedRawPath;
          trimSkippedReason =
            segments.length === 0
              ? 'no action windows recorded'
              : 'ffmpeg not found on PATH';
        } else {
          try {
            await trimVideo(
              ffmpeg,
              rawVideoPath,
              this.options.out,
              segments,
              signal
            );
            retainedRawPath = this.options.keepRaw
              ? await copyRaw(rawVideoPath, rawOut)
              : null;
            trimmed = true;
          } catch (error) {
            retainedRawPath = await copyRaw(rawVideoPath, rawOut);
            videoPath = retainedRawPath;
            trimSkippedReason = signal?.aborted
              ? 'session interrupted'
              : `ffmpeg trim failed: ${errorMessage(error)}`;
          }
        }
      }

      const actions =
        this.options.scope === 'scene'
          ? shiftActions(this.actions, this.sceneReadyOffsetMs)
          : this.actions;
      await writeFile(
        this.options.manifestOut,
        JSON.stringify(
          {
            mode: 'video',
            scope: this.options.scope,
            rawVideoPath: retainedRawPath,
            videoPath,
            sceneReadyOffsetMs: this.sceneReadyOffsetMs,
            trimmed,
            trimSkippedReason,
            paddingMs: this.options.paddingMs,
            actions,
            segments:
              this.options.scope === 'actions'
                ? mergeSegments(actions, this.options.paddingMs)
                : [],
          },
          null,
          2
        )
      );
      return {
        mode: 'video' as const,
        videoPath,
        manifestPath: this.options.manifestOut,
      };
    } finally {
      await rm(this.browserVideo.dir, {recursive: true, force: true});
    }
  }

  private elapsedMs() {
    return Math.max(0, Math.floor(this.clock() - this.startTimeMs));
  }
}

type Checkpoint = {
  index: number;
  kind: 'initial' | 'action' | 'final';
  actionIndex?: number;
};

class CheckpointRecorder implements SessionRecorder {
  readonly browserVideo = undefined;
  private readonly actions: SessionActionRecord[] = [];
  private readonly frames: Checkpoint[] = [];
  private readonly startedAt: number;

  private constructor(
    private readonly options: {out: string; manifestOut: string},
    private readonly frameDir: string,
    private readonly clock: () => number
  ) {
    this.startedAt = clock();
  }

  static async create(input: CheckpointRecordingOptions, clock: () => number) {
    const out = path.resolve(input.out);
    const frameDir = await mkdtemp(
      path.join(os.tmpdir(), 'xrblocks-checkpoints-')
    );
    return new CheckpointRecorder(
      {
        out,
        manifestOut: `${withoutExtension(out)}.recording.json`,
      },
      frameDir,
      clock
    );
  }

  videoStarted() {}
  sceneReady() {}

  async perform<T>(
    name: string,
    metadata: JsonObject | undefined,
    action: () => Promise<T>,
    capture: CapturePage
  ): Promise<T> {
    if (this.frames.length === 0) await this.capture('initial', capture);
    const startMs = this.elapsedMs();
    try {
      return await action();
    } finally {
      const actionIndex = this.actions.length;
      this.actions.push({
        name,
        startMs,
        endMs: Math.max(startMs, this.elapsedMs()),
        metadata,
      });
      await this.capture('action', capture, actionIndex);
    }
  }

  async beforeClose(capture: CapturePage) {
    if (this.frames.length === 0) await this.capture('initial', capture);
    await this.capture('final', capture);
  }

  discard() {
    return rm(this.frameDir, {recursive: true, force: true});
  }

  async finish(_rawVideoPath: string | undefined, signal?: AbortSignal) {
    try {
      const ffmpeg = await requireFfmpeg();
      signal?.throwIfAborted();
      await mkdir(path.dirname(this.options.out), {recursive: true});
      await mkdir(path.dirname(this.options.manifestOut), {recursive: true});
      await encodeCheckpoints(ffmpeg, this.frameDir, this.options.out, signal);
      await writeFile(
        this.options.manifestOut,
        JSON.stringify(
          {
            mode: 'checkpoints',
            videoPath: this.options.out,
            fps: 2,
            frames: this.frames,
            actions: this.actions,
          },
          null,
          2
        )
      );
      return {
        mode: 'checkpoints' as const,
        videoPath: this.options.out,
        manifestPath: this.options.manifestOut,
      };
    } finally {
      await rm(this.frameDir, {recursive: true, force: true});
    }
  }

  private async capture(
    kind: Checkpoint['kind'],
    capture: CapturePage,
    actionIndex?: number
  ) {
    const index = this.frames.length;
    const file = path.join(
      this.frameDir,
      `${String(index + 1).padStart(6, '0')}.png`
    );
    await writeFile(file, await capture());
    this.frames.push({
      index,
      kind,
      ...(actionIndex === undefined ? {} : {actionIndex}),
    });
  }

  private elapsedMs() {
    return Math.max(0, Math.floor(this.clock() - this.startedAt));
  }
}

function normalizeVideoOptions(
  options: VideoRecordingOptions
): NormalizedVideoOptions {
  const scope = options.scope ?? 'actions';
  if (scope !== 'actions' && options.paddingMs !== undefined) {
    throw new TypeError('Video paddingMs is only available for action scope.');
  }
  if (scope === 'full' && options.keepRaw) {
    throw new TypeError('Video keepRaw is not available for full scope.');
  }
  const requestedOut = path.resolve(options.out);
  const out =
    scope === 'full' && path.extname(requestedOut).toLowerCase() !== '.webm'
      ? `${withoutExtension(requestedOut)}.webm`
      : requestedOut;
  return {
    out,
    manifestOut: `${withoutExtension(out)}.recording.json`,
    scope,
    keepRaw: options.keepRaw ?? false,
    paddingMs: scope === 'actions' ? (options.paddingMs ?? 500) : 0,
    size: options.size,
  };
}

function mergeSegments(
  actions: SessionActionRecord[],
  paddingMs: number
): Segment[] {
  const padded = actions
    .map((action) => ({
      startMs: Math.max(0, Math.floor(action.startMs - paddingMs)),
      endMs: Math.max(0, Math.ceil(action.endMs + paddingMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  const segments: Segment[] = [];
  for (const segment of padded) {
    const previous = segments.at(-1);
    if (previous && segment.startMs <= previous.endMs)
      previous.endMs = Math.max(previous.endMs, segment.endMs);
    else segments.push({...segment});
  }
  return segments;
}

function shiftActions(actions: SessionActionRecord[], offsetMs: number) {
  return actions.map((action) => ({
    ...action,
    startMs: Math.max(0, action.startMs - offsetMs),
    endMs: Math.max(0, action.endMs - offsetMs),
  }));
}

async function copyRaw(source: string, destination: string) {
  await mkdir(path.dirname(destination), {recursive: true});
  await cp(source, destination);
  return destination;
}

async function requireFfmpeg() {
  const ffmpeg = await findExecutable('ffmpeg');
  if (!ffmpeg)
    throw new Error('ffmpeg is required to create Session MP4 files.');
  return ffmpeg;
}

async function findExecutable(name: string, envPath = process.env.PATH ?? '') {
  for (const segment of envPath.split(path.delimiter)) {
    if (!segment) continue;
    const candidate = path.join(segment, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return undefined;
}

async function trimVideo(
  ffmpeg: string,
  input: string,
  out: string,
  segments: Segment[],
  signal?: AbortSignal
) {
  const select = segments
    .map(
      ({startMs, endMs}) =>
        `between(t\\,${(startMs / 1000).toFixed(3)}\\,${(endMs / 1000).toFixed(3)})`
    )
    .join('+');
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-i',
      input,
      '-vf',
      `select='${select}',setpts=N/FRAME_RATE/TB`,
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ],
    {signal}
  );
}

async function transcodeFullVideo(
  ffmpeg: string,
  input: string,
  out: string,
  sceneReadyOffsetMs: number,
  signal?: AbortSignal
) {
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-i',
      input,
      '-ss',
      (sceneReadyOffsetMs / 1000).toFixed(3),
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ],
    {signal}
  );
}

async function encodeCheckpoints(
  ffmpeg: string,
  frameDir: string,
  out: string,
  signal?: AbortSignal
) {
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-framerate',
      '2',
      '-i',
      path.join(frameDir, '%06d.png'),
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ],
    {signal}
  );
}

function withoutExtension(file: string) {
  const extension = path.extname(file);
  return extension ? file.slice(0, -extension.length) : file;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
