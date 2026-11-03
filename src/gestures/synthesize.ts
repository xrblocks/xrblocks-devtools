import {augmentPose, randomGenerator} from './augment.js';
import {handFeatures} from './features.js';
import type {ResolvedTrainingConfig} from './schema.js';

export type GestureSample = {target: number; features: Float32Array};

export async function synthesize(
  config: ResolvedTrainingConfig,
  signal?: AbortSignal
) {
  const random = randomGenerator(config.seed);
  const training: GestureSample[] = [];
  const validation: GestureSample[] = [];
  const warnings: string[] = [];
  const labels = Object.keys(config.gestures);
  for (const [target, label] of labels.entries()) {
    for (const [configuration, pose] of config.gestures[label].entries()) {
      const generated = augmentPose(pose, {...config, constrain: true}, random);
      if (generated.adjusted)
        warnings.push(
          `Applied anatomical limits to ${label}[${configuration}].`
        );
      for (const {hand, sample, points} of generated.samples) {
        signal?.throwIfAborted();
        const features = handFeatures(points, hand, config.features);
        if (!features)
          throw new Error(
            `Degenerate hand in ${label}[${configuration}]. Reduce noise or fix the base pose.`
          );
        (sample > 0 && sample % 5 === 1 ? validation : training).push({
          target,
          features,
        });
        if (sample % 100 === 0)
          await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }
  return {labels, training, validation, warnings};
}
