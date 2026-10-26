import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HAND_POSE_JOINT_NAMES, NAMED_HAND_POSES} from '../session/types.js';
import type {HandPoseJointName, HandPoseRotations} from '../session/types.js';
import type {HandPreview, NormalizedPreviewInput} from './types.js';

export function parseHandJoints(values: string[]): HandPoseRotations {
  const rotations: HandPoseRotations = {};
  for (const value of values) {
    const match = /^([^=]+)=([^,]+),([^,]+),([^,]+)$/.exec(value);
    if (!match) throw new Error('--joint requires name=x,y,z in degrees.');
    const name = match[1] as HandPoseJointName;
    if (rotations[name]) throw new Error(`Duplicate hand joint: ${name}`);
    rotations[name] = [
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
    ].map((degrees) => (degrees * Math.PI) / 180) as [number, number, number];
  }
  validateHandPreview({rotations});
  return rotations;
}

export function validateHandPreview(options: HandPreview) {
  if (options.pose !== undefined && !NAMED_HAND_POSES.includes(options.pose)) {
    throw new Error(
      `Unknown hand pose: ${options.pose}. Use ${NAMED_HAND_POSES.join(', ')}.`
    );
  }
  if (
    options.hand !== undefined &&
    !['left', 'right', 'both'].includes(options.hand)
  ) {
    throw new Error('--hand must be left, right, or both.');
  }
  for (const [name, rotation] of Object.entries(options.rotations ?? {})) {
    if (!HAND_POSE_JOINT_NAMES.includes(name as HandPoseJointName)) {
      throw new Error(`Unknown hand joint: ${name}`);
    }
    if (
      !Array.isArray(rotation) ||
      rotation.length !== 3 ||
      !rotation.every(Number.isFinite)
    ) {
      throw new Error(`Hand joint ${name} requires three finite angles.`);
    }
  }
}

export async function prepareHandPreview(
  signal?: AbortSignal
): Promise<NormalizedPreviewInput> {
  const version = '1.0.20';
  const assetsDir = path.join(
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'),
    'xrblocks-devtools',
    'hands',
    version
  );
  await mkdir(assetsDir, {recursive: true});
  await Promise.all(
    ['left', 'right'].map(async (hand) => {
      const destination = path.join(assetsDir, `${hand}.glb`);
      const cached = await readFile(destination).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        }
      );
      if (cached?.toString('ascii', 0, 4) === 'glTF') return;
      const response = await fetch(
        `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@${version}/dist/profiles/generic-hand/${hand}.glb`,
        {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
            : AbortSignal.timeout(60_000),
        }
      );
      if (!response.ok)
        throw new Error(
          `Failed to download ${hand} hand model: HTTP ${response.status}`
        );
      const data = Buffer.from(await response.arrayBuffer());
      if (data.toString('ascii', 0, 4) !== 'glTF')
        throw new Error(`Invalid ${hand} hand model download.`);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data);
        signal?.throwIfAborted();
        await rename(temporary, destination);
      } finally {
        await rm(temporary, {force: true});
      }
    })
  );
  return {
    modulePath: fileURLToPath(new URL('./browser/hand.js', import.meta.url)),
    assetsDir,
  };
}
