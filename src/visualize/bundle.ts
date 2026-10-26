import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import type {VisualizeKind} from './types.js';

const browserEntries = {
  ui: fileURLToPath(new URL('./browser/ui.js', import.meta.url)),
  model: fileURLToPath(new URL('./browser/model.js', import.meta.url)),
  hand: fileURLToPath(new URL('./browser/model.js', import.meta.url)),
} satisfies Record<VisualizeKind, string>;

// XR Blocks loads these packages only when their optional features are used.
// Keep those imports lazy instead of making an isolated UI preview install
// every AI, perception, model, and navigation backend.
const xrblocksOptionalImports = [
  '@google/genai',
  '@mediapipe/tasks-audio',
  '@mediapipe/tasks-vision',
  '@sparkjsdev/spark',
  'openai',
  'three-mesh-bvh',
  'three-pathfinding',
  'troika-three-text',
];

export async function bundlePreviewEntry(options: {
  kind: VisualizeKind;
  previewPath: string;
  xrblocksEntry: string;
  outfile: string;
}) {
  await build({
    entryPoints: [browserEntries[options.kind]],
    outfile: options.outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: 'inline',
    external: ['three', 'three/*', ...xrblocksOptionalImports],
    logLevel: 'silent',
    absWorkingDir: path.dirname(options.previewPath),
    plugins: [
      {
        name: 'preview-module',
        setup(build) {
          build.onResolve({filter: /^virtual:preview$/}, () => ({
            path: options.previewPath,
          }));
          build.onResolve({filter: /^xrblocks$/}, () => ({
            path: options.xrblocksEntry,
          }));
        },
      },
    ],
  });
}
