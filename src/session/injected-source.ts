import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const injectedFiles = [
  'serialization.js',
  'xrblocks.js',
  'rendering.js',
  'targets.js',
  'spatial.js',
  'outputs.js',
  'context.js',
  'readiness.js',
  'screenshot.js',
  'harness.js',
];

export async function injectedAudioSource() {
  return readInjectedFile('audio.js');
}

export async function injectedHarnessSource() {
  const directory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'injected'
  );
  const parts = await Promise.all(
    injectedFiles.map((fileName) =>
      readFile(path.join(directory, fileName), 'utf8')
    )
  );
  return `(() => {\n${parts.join('\n\n')}\n})();\n`;
}

async function readInjectedFile(fileName: string) {
  const directory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'injected'
  );
  return readFile(path.join(directory, fileName), 'utf8');
}
