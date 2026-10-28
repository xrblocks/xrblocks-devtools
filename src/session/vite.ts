import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';
import type {RunningServer} from '../server.js';
import type {ViteDevServer} from 'vite';

const ADDON_ID = 'virtual:xrblocks-devtools-embodied-control';

export type ViteAppServer = RunningServer & {embodiedControlImport: string};

export async function serveViteApp(options: {
  appDir: string;
  xrblocksRoot?: string;
  signal?: AbortSignal;
}): Promise<ViteAppServer | undefined> {
  const root = path.resolve(options.appDir);
  const packageFile = path.join(root, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(packageFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const files = await readdir(root);
  const configFile = ['js', 'mjs', 'ts', 'cjs', 'mts', 'cts']
    .map((extension) => `vite.config.${extension}`)
    .find((file) => files.includes(file));
  const usesVite =
    manifest?.dependencies?.vite ||
    manifest?.devDependencies?.vite ||
    configFile;
  if (!usesVite) return undefined;

  let viteModule: string;
  try {
    viteModule = createRequire(packageFile).resolve('vite');
  } catch (error) {
    throw new Error(
      `Vite is not installed for ${root}. Install the app's dependencies before opening it with DevTools.`,
      {cause: error}
    );
  }
  options.signal?.throwIfAborted();
  const {createServer}: typeof import('vite') = await import(
    pathToFileURL(viteModule).href
  );
  const xrblocksRoot = options.xrblocksRoot
    ? path.resolve(options.xrblocksRoot)
    : undefined;
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: configFile ? path.join(root, configFile) : false,
      clearScreen: false,
      server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: false,
        open: false,
        middlewareMode: false,
      },
      resolve: xrblocksRoot
        ? {
            alias: [
              {
                find: /^xrblocks$/,
                replacement: path.join(xrblocksRoot, 'build/xrblocks.js'),
              },
              {
                find: /^xrblocks\/addons\//,
                replacement: `${path.join(xrblocksRoot, 'build/addons')}/`,
              },
            ],
          }
        : undefined,
      plugins: [
        {
          name: 'xrblocks-devtools-embodied-control',
          enforce: 'pre',
          config(config) {
            return {root: path.resolve(root, config.root ?? '.')};
          },
          configureServer: {
            order: 'pre',
            handler(instance) {
              server = instance;
            },
          },
          resolveId(id) {
            if (id === ADDON_ID) return `\0${ADDON_ID}`;
          },
          load(id) {
            if (id === `\0${ADDON_ID}`)
              return "export {EmbodiedControl} from 'xrblocks/addons/embodied-control/index.js';";
          },
        },
      ],
    });
    options.signal?.throwIfAborted();
    await server.listen();
    options.signal?.throwIfAborted();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error(`Vite did not expose a local URL for ${root}.`);
    const runningServer = server;
    let closing: Promise<void> | undefined;
    return {
      url,
      embodiedControlImport: new URL(`@id/__x00__${ADDON_ID}`, url).href,
      close: () =>
        (closing ??= (async () => {
          try {
            await runningServer.waitForRequestsIdle();
          } finally {
            await runningServer.close();
          }
        })()),
    };
  } catch (error) {
    await server?.close();
    throw error;
  }
}
