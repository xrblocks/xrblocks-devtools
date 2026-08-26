import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {
  copyDir,
  replaceWithSymlink,
  requireDir,
  requireFile,
} from '../fs-utils.js';
import {resolveSessionRuntimeAssets} from './runtime-assets.js';
import type {RuntimeAssets} from './types.js';

const XR_BLOCKS_VENDOR_ROOT = './vendor/xrblocks';
const XR_BLOCKS_IMPORT = './vendor/xrblocks/build/xrblocks.js';
const XR_BLOCKS_ADDONS_IMPORT = `${XR_BLOCKS_VENDOR_ROOT}/build/addons/`;
const NODE_MODULES_VENDOR_ROOT = './vendor/node_modules';
const XR_BLOCKS_IMPORTS = {
  three: './vendor/three/build/three.module.js',
  'three/': './vendor/three/',
  'three/addons/': './vendor/three/examples/jsm/',
  '@pmndrs/uikit': `${NODE_MODULES_VENDOR_ROOT}/@pmndrs/uikit/dist/index.js`,
  '@pmndrs/uikit-pub-sub': `${NODE_MODULES_VENDOR_ROOT}/@pmndrs/uikit-pub-sub/dist/index.js`,
  '@pmndrs/msdfonts': `${NODE_MODULES_VENDOR_ROOT}/@pmndrs/msdfonts/dist/index.js`,
  '@preact/signals-core': `${NODE_MODULES_VENDOR_ROOT}/@preact/signals-core/dist/signals-core.mjs`,
  'yoga-layout/load': `${NODE_MODULES_VENDOR_ROOT}/yoga-layout/dist/src/load.js`,
  lit: `${NODE_MODULES_VENDOR_ROOT}/lit/index.js`,
  'lit/': `${NODE_MODULES_VENDOR_ROOT}/lit/`,
  xrblocks: XR_BLOCKS_IMPORT,
  'xrblocks/addons/': XR_BLOCKS_ADDONS_IMPORT,
} satisfies Record<string, string>;
const THREE_PATHFINDING_IMPORT =
  './vendor/three-pathfinding/dist/three-pathfinding.module.js';

export type MaterializedAppWorkspace = {
  rootDir: string;
  appDir: string;
  cleanup: () => Promise<void>;
};

export async function materializeAppWorkspace(options: {
  appDir: string;
  xrblocksRoot?: string;
  simulatorNavMesh?: boolean;
}): Promise<MaterializedAppWorkspace> {
  const sourceAppDir = path.resolve(options.appDir);
  await requireDir(sourceAppDir, 'XR Blocks app directory');
  await requireFile(
    path.join(sourceAppDir, 'index.html'),
    'XR Blocks app index.html'
  );
  const runtime = await resolveSessionRuntimeAssets({
    appDir: sourceAppDir,
    xrblocksRoot: options.xrblocksRoot,
    simulatorNavMesh: options.simulatorNavMesh,
  });
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'xrblocks-devtools-'));

  const materializedAppDir = path.join(rootDir, 'app');
  try {
    await copyDir(sourceAppDir, materializedAppDir);
    await rewriteXrblocksVendorImports(
      sourceAppDir,
      materializedAppDir,
      runtime
    );
    const vendorDir = path.join(materializedAppDir, 'vendor');
    await replaceWithSymlink(
      runtime.xrblocksRoot,
      path.join(vendorDir, 'xrblocks')
    );
    await replaceWithSymlink(runtime.threeDir, path.join(vendorDir, 'three'));
    await replaceWithSymlink(
      runtime.nodeModulesDir,
      path.join(vendorDir, 'node_modules')
    );
    if (runtime.threePathfindingDir) {
      await replaceWithSymlink(
        runtime.threePathfindingDir,
        path.join(vendorDir, 'three-pathfinding')
      );
    }
  } catch (error) {
    await rm(rootDir, {recursive: true, force: true});
    throw error;
  }

  return {
    rootDir,
    appDir: materializedAppDir,
    cleanup: () => rm(rootDir, {recursive: true, force: true}),
  };
}

async function rewriteXrblocksVendorImports(
  sourceAppDir: string,
  materializedAppDir: string,
  runtime: RuntimeAssets
) {
  const htmlFiles = await findHtmlFiles(sourceAppDir);
  for (const sourceHtmlPath of htmlFiles) {
    const relativeHtmlPath = path.relative(sourceAppDir, sourceHtmlPath);
    const materializedHtmlPath = path.join(
      materializedAppDir,
      relativeHtmlPath
    );
    const sourceHtml = await readFile(sourceHtmlPath, 'utf8');
    const rewrittenHtml = rewriteXrblocksHtmlReferences(
      sourceHtml,
      path.dirname(sourceHtmlPath),
      runtime
    );
    if (rewrittenHtml !== sourceHtml)
      await writeFile(materializedHtmlPath, rewrittenHtml, 'utf8');
  }
}

async function findHtmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') return [];
        return findHtmlFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : [];
    })
  );
  return files.flat();
}

function rewriteXrblocksHtmlReferences(
  html: string,
  sourceHtmlDir: string,
  runtime: RuntimeAssets
) {
  const rewrittenReferences = html.replace(
    /(["'])([^"']+)(\1)/g,
    (match, openQuote: string, importValue: string, closeQuote: string) => {
      if (importValue.startsWith('./vendor/')) return match;
      const vendorValue =
        nodeModulesVendorReferenceValue(importValue) ??
        xrblocksVendorReferenceValue(importValue, sourceHtmlDir, runtime);
      return vendorValue ? `${openQuote}${vendorValue}${closeQuote}` : match;
    }
  );
  return rewriteXrblocksImportMapValues(rewrittenReferences, runtime);
}

function rewriteXrblocksImportMapValues(html: string, runtime: RuntimeAssets) {
  return html.replace(
    /(<script\b[^>]*\btype=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (match, openTag: string, content: string, closeTag: string) => {
      let importMap: unknown;
      try {
        importMap = JSON.parse(content);
      } catch {
        return match;
      }

      if (!isJsonObject(importMap) || !isJsonObject(importMap.imports))
        return match;

      Object.assign(importMap.imports, XR_BLOCKS_IMPORTS);
      if (runtime.threePathfindingDir) {
        importMap.imports['three-pathfinding'] = THREE_PATHFINDING_IMPORT;
      }

      return `${openTag}\n${JSON.stringify(importMap, null, 2)}\n${closeTag}`;
    }
  );
}

function nodeModulesVendorReferenceValue(importValue: string) {
  const localPrefix = './node_modules/';
  if (!importValue.startsWith(localPrefix)) return undefined;
  return `${NODE_MODULES_VENDOR_ROOT}/${importValue.slice(localPrefix.length)}`;
}

function xrblocksVendorReferenceValue(
  importValue: string,
  sourceHtmlDir: string,
  runtime: RuntimeAssets
) {
  const relativeXrblocksPath = xrblocksPackageRelativePath(
    importValue,
    sourceHtmlDir,
    runtime.xrblocksRoot
  );
  if (relativeXrblocksPath === undefined) return undefined;

  return relativeXrblocksPath
    ? `${XR_BLOCKS_VENDOR_ROOT}/${relativeXrblocksPath}`
    : `${XR_BLOCKS_VENDOR_ROOT}/`;
}

function xrblocksPackageRelativePath(
  htmlValue: string,
  sourceHtmlDir: string,
  xrblocksRoot: string
) {
  if (!isRelativePathReference(htmlValue)) return undefined;

  const resolvedImportPath = path.resolve(sourceHtmlDir, htmlValue);
  const relativeXrblocksPath = path.relative(xrblocksRoot, resolvedImportPath);
  if (
    !relativeXrblocksPath.startsWith('..') &&
    !path.isAbsolute(relativeXrblocksPath)
  )
    return normalizeRelativeUrlPath(relativeXrblocksPath, htmlValue);

  return undefined;
}

function isRelativePathReference(value: string) {
  return value.startsWith('./') || value.startsWith('../');
}

function normalizeRelativeUrlPath(relativePath: string, originalValue: string) {
  const normalizedPath = relativePath.split(path.sep).join('/');
  if (
    originalValue.endsWith('/') &&
    normalizedPath &&
    !normalizedPath.endsWith('/')
  )
    return `${normalizedPath}/`;
  return normalizedPath;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
