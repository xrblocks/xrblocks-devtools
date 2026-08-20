import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import type {SimulatorObjectInput} from './types.js';

export const MAX_SIMULATOR_OBJECT_FILE_BYTES = 50 * 1024 * 1024;

export type MaterializedSimulatorObjectInput = Omit<
  SimulatorObjectInput,
  'file' | 'object'
> & {
  objectJson?: unknown;
};

export async function materializeSimulatorObjectInputs(
  definitions: SimulatorObjectInput[]
): Promise<MaterializedSimulatorObjectInput[]> {
  if (!Array.isArray(definitions)) {
    throw new TypeError('Simulator object definitions must be an array.');
  }

  return Promise.all(
    definitions.map(async (def, index) => {
      if (!def || typeof def !== 'object') {
        throw new TypeError(
          `Simulator object at index ${index} must be an object.`
        );
      }

      validateSourceOptions(def, index);

      if (def.file) {
        const filePath = path.resolve(def.file);
        const dataUrl = await readModelFileAsDataUrl(filePath);
        const {file: _, ...rest} = def;
        return {
          ...rest,
          assetPath: dataUrl,
        };
      }

      if (def.object) {
        const {object, ...rest} = def;
        const objectJson = object.toJSON();
        if (!objectJson || typeof objectJson !== 'object') {
          throw new TypeError(
            `Simulator object at index ${index} returned invalid Three.js JSON.`
          );
        }
        return {...rest, objectJson};
      }

      return {...def};
    })
  );
}

function validateSourceOptions(def: SimulatorObjectInput, index: number) {
  const sources = [
    def.assetPath !== undefined,
    def.file !== undefined,
    def.object !== undefined,
  ].filter(Boolean);

  if (sources.length !== 1) {
    throw new Error(
      `Simulator object at index ${index} must specify exactly one of 'assetPath', 'file', or 'object'.`
    );
  }
}

async function readModelFileAsDataUrl(filePath: string): Promise<string> {
  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    throw new Error(`Simulator object file not found: ${filePath}`);
  }
  if (fileStat.size > MAX_SIMULATOR_OBJECT_FILE_BYTES) {
    throw new Error('Simulator object file must not exceed 50 MB.');
  }

  const ext = path.extname(filePath).toLowerCase();
  let mimeType = 'model/gltf-binary';
  if (ext === '.gltf' || ext === '.json') {
    mimeType = 'model/gltf+json';
  } else if (ext === '.glb') {
    mimeType = 'model/gltf-binary';
  } else {
    throw new Error(
      `Unsupported 3D model file format: ${filePath}. Supported extensions: .glb, .gltf.`
    );
  }

  const bytes = await readFile(filePath);
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}
