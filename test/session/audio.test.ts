import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {
  materializeAudioInjection,
  MAX_AUDIO_TEXT_LENGTH,
} from '../../src/session/audio.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, {recursive: true, force: true}))
  );
});

describe('audio injection materialization', () => {
  it('reads a local RIFF/WAVE file', async () => {
    const directory = await makeTempDir();
    const filePath = path.join(directory, 'speech.wav');
    const wav = makeWav();
    await writeFile(filePath, wav);

    const result = await materializeAudioInjection({file: filePath});

    expect(result.source).toBe('file');
    expect(result.bytes).toEqual(wav);
    await result.cleanup();
  });

  it('rejects non-WAV files', async () => {
    const directory = await makeTempDir();
    const filePath = path.join(directory, 'speech.wav');
    await writeFile(filePath, 'not audio');

    await expect(materializeAudioInjection({file: filePath})).rejects.toThrow(
      'requires a RIFF/WAVE file'
    );
  });

  it('validates the discriminated input and text limit', async () => {
    await expect(
      materializeAudioInjection({} as {text: string})
    ).rejects.toThrow('exactly one');
    await expect(
      materializeAudioInjection({text: 'x'.repeat(MAX_AUDIO_TEXT_LENGTH + 1)})
    ).rejects.toThrow(`${MAX_AUDIO_TEXT_LENGTH} characters`);
  });
});

async function makeTempDir() {
  const directory = await mkdtemp(path.join(tmpdir(), 'xrblocks-audio-test-'));
  tempDirs.push(directory);
  return directory;
}

function makeWav() {
  const samples = Buffer.from([0xff, 0x7f]);
  const wav = Buffer.alloc(44 + samples.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples.length, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length, 40);
  samples.copy(wav, 44);
  return wav;
}
