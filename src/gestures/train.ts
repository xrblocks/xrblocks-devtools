import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {HAND_JOINT_NAMES} from '../hands/types.js';
import {fitClassifier, predictFeatures} from './classifier.js';
import {gestureTrainingSchema} from './schema.js';
import type {GestureManifest, GestureTrainingConfig} from './schema.js';
import {synthesize} from './synthesize.js';
import {encodeTFLite} from './tflite.js';

export async function trainGestures(options: {
  config: GestureTrainingConfig;
  out: string;
  signal?: AbortSignal;
}) {
  options.signal?.throwIfAborted();
  const config = gestureTrainingSchema.parse(options.config);
  const out = path.resolve(options.out);
  if (!out.endsWith('.tflite')) throw new Error('Output must end in .tflite.');
  const manifestPath = out.slice(0, -7) + '.json';
  const {labels, training, validation, warnings} = await synthesize(
    config,
    options.signal
  );
  const model = await fitClassifier(training, labels.length, options.signal);
  const confusion = labels.map(() => labels.map(() => 0));
  let correct = 0;
  let rejected = 0;
  for (const {target, features} of validation) {
    const scores = predictFeatures(model, features);
    const best = scores.indexOf(Math.max(...scores));
    confusion[target][best]++;
    if (scores[best] < config.threshold) rejected++;
    else if (best === target) correct++;
  }
  const manifest: GestureManifest = {
    format: 'xrblocks-hand-gestures',
    version: 1,
    features: 'palm-local-xyz-v1',
    joints: [...HAND_JOINT_NAMES],
    labels,
    threshold: config.threshold,
  };
  const bytes = encodeTFLite(model, manifest);
  await mkdir(path.dirname(out), {recursive: true});
  const temporary = `${out}.${randomUUID()}.tmp`;
  const temporaryManifest = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await writeFile(
      temporaryManifest,
      JSON.stringify(manifest, null, 2) + '\n'
    );
    options.signal?.throwIfAborted();
    await rename(temporaryManifest, manifestPath);
    await rename(temporary, out);
  } finally {
    await rm(temporary, {force: true});
    await rm(temporaryManifest, {force: true});
  }
  return {
    out,
    manifest: manifestPath,
    labels,
    bytes: bytes.length,
    trainingSamples: training.length,
    validationSamples: validation.length,
    syntheticValidation: {
      accuracy: correct / validation.length,
      rejected,
      confusion,
    },
    settings: config,
    warnings,
  };
}
