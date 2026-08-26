import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

export const MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_TEXT_LENGTH = 500;

export type AudioInjection = {file: string} | {text: string};

export type AudioInjectionResult = {
  completed: true;
  source: 'file' | 'text';
  durationMs: number;
  sampleRate: number;
  channels: number;
  frameStepped: true;
};

export type WaitForAudioConsumerOptions = {
  timeoutMs?: number;
};

export type AudioConsumerState = {
  activeConsumers: number;
  injectionActive: boolean;
  contextState: string;
};

export async function materializeAudioInjection(input: AudioInjection) {
  assertAudioInjection(input);
  if ('file' in input) {
    const filePath = path.resolve(input.file);
    return {
      source: 'file' as const,
      bytes: await readWavFile(filePath),
      cleanup: async () => {},
    };
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'xrblocks-tts-'));
  const filePath = path.join(directory, 'speech.wav');
  try {
    await synthesizeText(input.text, filePath);
    return {
      source: 'text' as const,
      bytes: await readWavFile(filePath),
      cleanup: () => rm(directory, {recursive: true, force: true}),
    };
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}

function assertAudioInjection(input: AudioInjection) {
  if (!input || typeof input !== 'object') {
    throw new Error('Audio injection requires {file} or {text}.');
  }
  const hasFile = 'file' in input;
  const hasText = 'text' in input;
  if (hasFile === hasText) {
    throw new Error(
      'Audio injection requires exactly one of {file} or {text}.'
    );
  }
  if (hasFile && (typeof input.file !== 'string' || !input.file.trim())) {
    throw new Error('Audio injection file must be a non-empty path.');
  }
  if (hasText) {
    if (typeof input.text !== 'string' || !input.text.trim()) {
      throw new Error('Audio injection text must be non-empty.');
    }
    if (input.text.length > MAX_AUDIO_TEXT_LENGTH) {
      throw new Error(
        `Audio injection text must not exceed ${MAX_AUDIO_TEXT_LENGTH} characters.`
      );
    }
  }
}

async function readWavFile(filePath: string) {
  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) throw new Error(`WAV file not found: ${filePath}`);
  if (fileStat.size > MAX_AUDIO_FILE_BYTES) {
    throw new Error('WAV file must not exceed 25 MB.');
  }
  const bytes = await readFile(filePath);
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error(`Audio injection requires a RIFF/WAVE file: ${filePath}`);
  }
  return bytes;
}

type TinyTTSInstance = {
  speak(text: string, output: string): Promise<unknown>;
  dispose?(): Promise<unknown> | unknown;
};

type TinyTTSConstructor = new () => TinyTTSInstance;

async function synthesizeText(text: string, outputPath: string) {
  let module: {default?: TinyTTSConstructor};
  try {
    const packageName: string = 'tiny-tts';
    module = await import(packageName);
  } catch (error) {
    if (isMissingTinyTTSError(error)) {
      throw new Error(
        'Text-to-speech requires the optional tiny-tts package. Install it with `npm install --save-dev tiny-tts`.'
      );
    }
    throw error;
  }
  const TinyTTS = module.default;
  if (typeof TinyTTS !== 'function') {
    throw new Error(
      'The installed tiny-tts package has no default constructor.'
    );
  }
  const tts = new TinyTTS();
  try {
    await tts.speak(text, outputPath);
  } finally {
    await tts.dispose?.();
  }
}

function isMissingTinyTTSError(error: unknown) {
  const code = (error as {code?: unknown})?.code;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 'ERR_MODULE_NOT_FOUND' ||
    message.includes("Cannot find package 'tiny-tts'") ||
    message.includes("Cannot find module 'tiny-tts'") ||
    message.includes('Could not resolve "tiny-tts"')
  );
}
