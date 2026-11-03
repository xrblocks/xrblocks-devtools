import {build} from 'esbuild';
import path from 'node:path';

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

export async function bundleBrowserEntry(options: {
  entryPath: string;
  modulePath: string;
  xrblocksEntry?: string;
  outfile: string;
}) {
  await build({
    entryPoints: [options.entryPath],
    outfile: options.outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: 'inline',
    external: ['three', 'three/*', ...xrblocksOptionalImports],
    logLevel: 'silent',
    absWorkingDir: path.dirname(options.modulePath),
    plugins: [
      {
        name: 'input-module',
        setup(build) {
          build.onResolve({filter: /^virtual:input$/}, () => ({
            path: options.modulePath,
          }));
          if (options.xrblocksEntry) {
            build.onResolve({filter: /^xrblocks$/}, () => ({
              path: options.xrblocksEntry!,
            }));
          }
        },
      },
    ],
  });
}
