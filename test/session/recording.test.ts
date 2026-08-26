import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createSessionRecorder} from '../../src/session/recording.js';

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((directory) => rm(directory, {recursive: true, force: true}))
  );
});

describe('Session recording', () => {
  it('records action checkpoints and a final frame', async () => {
    const directory = await temporaryDirectory();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = await fakeFfmpeg(directory);
      const out = path.join(directory, 'run.mp4');
      const recorder = await createSessionRecorder({
        mode: 'checkpoints',
        out,
      });
      if (!recorder) throw new Error('Expected a recorder.');
      const capture = async () => Buffer.from('frame');

      await recorder.perform(
        'click',
        {hand: 'right'},
        async () => true,
        capture
      );
      await recorder.beforeClose(capture);
      const artifact = await recorder.finish(undefined);

      expect(artifact).toEqual({
        mode: 'checkpoints',
        videoPath: out,
        manifestPath: path.join(directory, 'run.recording.json'),
      });
      const manifest = JSON.parse(
        await readFile(artifact.manifestPath, 'utf8')
      );
      expect(manifest.frames.map(({kind}: {kind: string}) => kind)).toEqual([
        'initial',
        'action',
        'final',
      ]);
      expect(manifest.actions).toHaveLength(1);
      await expect(stat(out)).resolves.toBeDefined();
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('reports the raw WebM when action trimming is unavailable', async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, 'raw.webm');
    const out = path.join(directory, 'run.mp4');
    await writeFile(input, 'video');
    const recorder = await createSessionRecorder({
      mode: 'video',
      out,
    });
    if (!recorder) throw new Error('Expected a recorder.');

    await recorder.perform(
      'wait',
      {durationMs: 10},
      async () => true,
      async () => Buffer.alloc(0)
    );
    const originalPath = process.env.PATH;
    let artifact;
    try {
      process.env.PATH = '';
      artifact = await recorder.finish(input);
    } finally {
      process.env.PATH = originalPath;
    }

    expect(artifact.mode).toBe('video');
    expect(artifact.videoPath).toBe(path.join(directory, 'run.raw.webm'));
    await expect(readFile(artifact.videoPath, 'utf8')).resolves.toBe('video');
    const manifest = JSON.parse(await readFile(artifact.manifestPath, 'utf8'));
    expect(manifest.actions[0].name).toBe('wait');
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recording-test-'));
  temporaryDirs.push(directory);
  return directory;
}

async function fakeFfmpeg(directory: string) {
  const bin = path.join(directory, 'bin');
  await mkdir(bin);
  const executable = path.join(bin, 'ffmpeg');
  await writeFile(
    executable,
    '#!/bin/sh\nfor argument in "$@"; do output="$argument"; done\n: > "$output"\n'
  );
  await chmod(executable, 0o755);
  return bin;
}
