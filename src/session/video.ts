import {access, cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {JsonObject} from '../types.js';
import type {Viewport} from './types.js';

const execFileAsync = promisify(execFile);

export type SessionVideoRecordingOptions = {
  out: string;
  timelineOut?: string;
  /** Recorded video dimensions in pixels. Defaults to the browser viewport. */
  size?: Viewport;
  trim?: boolean;
  /** Transcode the complete recording from scene readiness to MP4. */
  fromSceneReady?: boolean;
  keepRaw?: boolean;
  paddingMs?: number;
};

export type NormalizedVideoRecordingOptions = {
  out: string;
  timelineOut: string;
  trim: boolean;
  fromSceneReady: boolean;
  keepRaw: boolean;
  paddingMs: number;
};

export type VideoActionWindow = {
  name: string;
  startMs: number;
  endMs: number;
  metadata?: JsonObject;
};

export type VideoSegment = {
  startMs: number;
  endMs: number;
};

export type VideoTimeline = {
  rawVideoPath: string | null;
  outputVideoPath: string;
  fromSceneReady: boolean;
  /** Raw Playwright video discarded before the ready scene begins. */
  sceneReadyOffsetMs: number;
  trimmed: boolean;
  trimSkippedReason: string | null;
  paddingMs: number;
  actions: VideoActionWindow[];
  segments: VideoSegment[];
};

export function normalizeVideoRecordingOptions(
  recordVideo?: SessionVideoRecordingOptions
): NormalizedVideoRecordingOptions | undefined {
  const options = recordVideo;
  if (!options) return undefined;
  const fromSceneReady = options.fromSceneReady ?? false;
  const trim = fromSceneReady ? false : (options.trim ?? true);
  const requestedOut = path.resolve(options.out);
  const out =
    !trim &&
    !fromSceneReady &&
    path.extname(requestedOut).toLowerCase() !== '.webm'
      ? `${withoutExtension(requestedOut)}.webm`
      : requestedOut;
  return {
    out,
    timelineOut: path.resolve(
      options.timelineOut ?? `${withoutExtension(out)}.timeline.json`
    ),
    trim,
    fromSceneReady,
    keepRaw: options.keepRaw ?? false,
    paddingMs: fromSceneReady ? 0 : (options.paddingMs ?? 500),
  };
}

export function mergeActionSegments(
  actions: VideoActionWindow[],
  paddingMs: number
): VideoSegment[] {
  const padded = actions
    .map((action) => ({
      startMs: Math.max(0, Math.floor(action.startMs - paddingMs)),
      endMs: Math.max(0, Math.ceil(action.endMs + paddingMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const segments: VideoSegment[] = [];
  for (const segment of padded) {
    const previous = segments.at(-1);
    if (previous && segment.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
    } else {
      segments.push({...segment});
    }
  }
  return segments;
}

export function createVideoTimeline(options: {
  rawVideoPath: string | null;
  outputVideoPath: string;
  fromSceneReady?: boolean;
  sceneReadyOffsetMs?: number;
  paddingMs: number;
  actions: VideoActionWindow[];
  trimResult: {trimmed: boolean; trimSkippedReason: string | null};
}): VideoTimeline {
  return {
    rawVideoPath: options.rawVideoPath,
    outputVideoPath: options.outputVideoPath,
    fromSceneReady: options.fromSceneReady ?? false,
    sceneReadyOffsetMs: options.sceneReadyOffsetMs ?? 0,
    trimmed: options.trimResult.trimmed,
    trimSkippedReason: options.trimResult.trimSkippedReason,
    paddingMs: options.paddingMs,
    actions: options.actions,
    segments: options.fromSceneReady
      ? []
      : mergeActionSegments(options.actions, options.paddingMs),
  };
}

export class SessionVideoRecorder {
  readonly rawDir: string;
  readonly options: NormalizedVideoRecordingOptions;
  private readonly actions: VideoActionWindow[] = [];
  private startTimeMs: number;
  private sceneReadyOffsetMs = 0;

  private constructor(
    options: NormalizedVideoRecordingOptions,
    rawDir: string,
    private readonly clock: () => number
  ) {
    this.options = options;
    this.rawDir = rawDir;
    this.startTimeMs = clock();
  }

  markVideoStarted() {
    this.startTimeMs = this.clock();
    this.sceneReadyOffsetMs = 0;
  }

  markSceneReady() {
    this.sceneReadyOffsetMs = this.elapsedMs();
  }

  static async create(
    recordVideo?: SessionVideoRecordingOptions,
    clock: () => number = () => performance.now()
  ) {
    const options = normalizeVideoRecordingOptions(recordVideo);
    if (!options) return undefined;
    const rawDir = await mkdtemp(path.join(os.tmpdir(), 'xrblocks-video-'));
    return new SessionVideoRecorder(options, rawDir, clock);
  }

  async recordAction<T>(
    name: string,
    metadata: JsonObject | undefined,
    action: () => Promise<T>
  ): Promise<T> {
    const startMs = this.elapsedMs();
    try {
      return await action();
    } finally {
      const endMs = Math.max(startMs, this.elapsedMs());
      this.actions.push({name, startMs, endMs, metadata});
    }
  }

  async finish(rawVideoPath: string | undefined, signal?: AbortSignal) {
    try {
      if (!rawVideoPath) return undefined;

      const rawOut = this.rawOutputPath();
      let timelineRawPath: string | null = rawVideoPath;
      let trimResult = {
        trimmed: false,
        trimSkippedReason: null as string | null,
      };

      await mkdir(path.dirname(this.options.out), {recursive: true});
      await mkdir(path.dirname(this.options.timelineOut), {recursive: true});

      if (this.options.fromSceneReady) {
        const ffmpeg = await findExecutable('ffmpeg');
        if (signal?.aborted) signal.throwIfAborted();
        if (!ffmpeg) {
          throw new Error(
            'ffmpeg is required to create a scene-ready MP4 recording.'
          );
        }
        try {
          await transcodeFullVideo(
            ffmpeg,
            rawVideoPath,
            this.options.out,
            this.sceneReadyOffsetMs,
            signal
          );
        } catch (error) {
          throw new Error(
            `ffmpeg could not create the Session MP4: ${errorMessage(error)}`,
            {
              cause: error,
            }
          );
        }
        if (this.options.keepRaw)
          timelineRawPath = await this.copyRawFallback(rawVideoPath, rawOut);
        else timelineRawPath = null;
        trimResult = {
          trimmed: false,
          trimSkippedReason: 'recording starts at scene readiness',
        };
      } else if (!this.options.trim) {
        await cp(rawVideoPath, this.options.out);
        timelineRawPath = this.options.out;
        trimResult = {
          trimmed: false,
          trimSkippedReason: 'trimming disabled',
        };
      } else if (signal?.aborted) {
        timelineRawPath = await this.copyRawFallback(rawVideoPath, rawOut);
        trimResult = {
          trimmed: false,
          trimSkippedReason: 'session interrupted',
        };
      } else {
        const segments = mergeActionSegments(
          this.actions,
          this.options.paddingMs
        );
        const ffmpeg = await findExecutable('ffmpeg');
        if (segments.length === 0) {
          timelineRawPath = await this.copyRawFallback(rawVideoPath, rawOut);
          trimResult = {
            trimmed: false,
            trimSkippedReason: 'no action windows recorded',
          };
        } else if (!ffmpeg) {
          timelineRawPath = await this.copyRawFallback(rawVideoPath, rawOut);
          trimResult = {
            trimmed: false,
            trimSkippedReason: 'ffmpeg not found on PATH',
          };
        } else {
          try {
            await trimVideo(
              ffmpeg,
              rawVideoPath,
              this.options.out,
              segments,
              signal
            );
            if (this.options.keepRaw)
              timelineRawPath = await this.copyRawFallback(
                rawVideoPath,
                rawOut
              );
            else timelineRawPath = null;
            trimResult = {trimmed: true, trimSkippedReason: null};
          } catch (error) {
            timelineRawPath = await this.copyRawFallback(rawVideoPath, rawOut);
            trimResult = signal?.aborted
              ? {trimmed: false, trimSkippedReason: 'session interrupted'}
              : {
                  trimmed: false,
                  trimSkippedReason: `ffmpeg trim failed: ${errorMessage(error)}`,
                };
          }
        }
      }

      const timeline = createVideoTimeline({
        rawVideoPath: timelineRawPath,
        outputVideoPath: this.options.out,
        fromSceneReady: this.options.fromSceneReady,
        sceneReadyOffsetMs: this.sceneReadyOffsetMs,
        paddingMs: this.options.paddingMs,
        actions: this.options.fromSceneReady
          ? shiftActionWindows(this.actions, this.sceneReadyOffsetMs)
          : this.actions,
        trimResult,
      });
      await writeFile(
        this.options.timelineOut,
        JSON.stringify(timeline, null, 2)
      );

      return timeline;
    } finally {
      await rm(this.rawDir, {recursive: true, force: true});
    }
  }

  private elapsedMs() {
    return Math.max(0, Math.floor(this.clock() - this.startTimeMs));
  }

  private rawOutputPath() {
    return `${withoutExtension(this.options.out)}.raw.webm`;
  }

  private async copyRawFallback(rawVideoPath: string, rawOut: string) {
    await mkdir(path.dirname(rawOut), {recursive: true});
    await cp(rawVideoPath, rawOut);
    return rawOut;
  }
}

export async function findExecutable(
  name: string,
  envPath = process.env.PATH ?? ''
) {
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
  rawVideoPath: string,
  out: string,
  segments: VideoSegment[],
  signal?: AbortSignal
) {
  const select = segments
    .map(
      (segment) =>
        `between(t\\,${(segment.startMs / 1000).toFixed(3)}\\,${(segment.endMs / 1000).toFixed(3)})`
    )
    .join('+');
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-i',
      rawVideoPath,
      '-vf',
      `select='${select}',mpdecimate,setpts=N/FRAME_RATE/TB`,
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
  rawVideoPath: string,
  out: string,
  sceneReadyOffsetMs: number,
  signal?: AbortSignal
) {
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-i',
      rawVideoPath,
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

export function shiftActionWindows(
  actions: VideoActionWindow[],
  offsetMs: number
): VideoActionWindow[] {
  return actions.map((action) => ({
    ...action,
    startMs: Math.max(0, action.startMs - offsetMs),
    endMs: Math.max(0, action.endMs - offsetMs),
  }));
}

function withoutExtension(filePath: string) {
  const extension = path.extname(filePath);
  return extension ? filePath.slice(0, -extension.length) : filePath;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
