import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {ActEvent, ActResult} from './index.js';
import type {JsonObject} from '../types.js';

export type ActArtifacts = {
  trajectoryPath: string;
  imagePaths: string[];
};

export async function writeActArtifacts(
  result: ActResult,
  outDir: string,
  runNumber: number
): Promise<ActArtifacts> {
  const stem = `act-${String(runNumber).padStart(3, '0')}`;
  await mkdir(outDir, {recursive: true});
  const imagePaths: string[] = [];
  const events: ActEvent[] = [];

  for (const event of result.trajectory.events) {
    events.push(await extractEventImages(event, outDir, stem, imagePaths));
  }

  const trajectoryPath = path.join(outDir, `${stem}.trajectory.jsonl`);
  const records = [
    {
      record: 'trajectory',
      schemaVersion: result.trajectory.schemaVersion,
      instruction: result.trajectory.instruction,
      configuration: result.trajectory.configuration,
      status: result.status,
      ...(result.exit ? {exit: result.exit} : {}),
      usage: result.usage,
    },
    ...events.map((event) => ({record: 'event', event})),
  ];
  await writeFile(
    trajectoryPath,
    records.map((record) => JSON.stringify(record)).join('\n') + '\n'
  );
  return {trajectoryPath, imagePaths};
}

async function extractEventImages(
  event: ActEvent,
  outDir: string,
  stem: string,
  imagePaths: string[]
): Promise<ActEvent> {
  const copy = structuredClone(event);
  if (copy.type !== 'observation') return copy;
  const result = asObject(copy.result);
  if (!Array.isArray(result?.images)) return copy;

  for (const value of result.images) {
    const image = asObject(value);
    if (typeof image?.dataUrl !== 'string') continue;
    const parsed = parseDataImage(image.dataUrl);
    if (!parsed) continue;
    const number = imagePaths.length + 1;
    const imagePath = path.join(
      outDir,
      `${stem}-turn-${String(copy.turn).padStart(3, '0')}-image-${String(number).padStart(3, '0')}.${parsed.extension}`
    );
    await writeFile(imagePath, Buffer.from(parsed.base64, 'base64'));
    imagePaths.push(imagePath);
    delete image.dataUrl;
    image.path = path.basename(imagePath);
    image.mimeType ??= parsed.mimeType;
  }
  return copy;
}

function parseDataImage(dataUrl: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(dataUrl);
  if (!match) return undefined;
  const mimeType = match[1]!.toLowerCase();
  return {
    mimeType,
    base64: match[2]!,
    extension: imageExtension(mimeType),
  };
}

function imageExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/svg+xml') return 'svg';
  const subtype = mimeType.slice('image/'.length);
  return /^[a-z0-9]+$/.test(subtype) ? subtype : 'img';
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
