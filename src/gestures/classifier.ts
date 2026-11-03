import type {GestureSample} from './synthesize.js';

export type GestureClassifier = {weights: Float32Array[]; bias: Float32Array};

export function predictFeatures(
  model: GestureClassifier,
  features: Float32Array
): Float64Array {
  const scores = Float64Array.from(model.weights, (weights, k) =>
    weights.reduce((sum, value, i) => sum + value * features[i], model.bias[k])
  );
  const max = Math.max(...scores);
  let sum = 0;
  for (let k = 0; k < scores.length; k++)
    sum += scores[k] = Math.exp(scores[k] - max);
  return scores.map((value) => value / sum);
}

export async function fitClassifier(
  samples: GestureSample[],
  classes: number,
  signal?: AbortSignal
): Promise<GestureClassifier> {
  const dimensions = samples[0].features.length;
  const mean = new Float64Array(dimensions);
  const scale = new Float64Array(dimensions);
  const counts = new Float64Array(classes);
  for (const {features, target} of samples) {
    counts[target]++;
    for (let j = 0; j < dimensions; j++)
      mean[j] += features[j] / samples.length;
  }
  for (const {features} of samples) {
    for (let j = 0; j < dimensions; j++)
      scale[j] += (features[j] - mean[j]) ** 2 / samples.length;
  }
  for (let j = 0; j < dimensions; j++)
    scale[j] = Math.max(0.05, Math.sqrt(scale[j]));
  const normalized = samples.map(({features, target}) => ({
    target,
    features: Float32Array.from(features, (v, j) => (v - mean[j]) / scale[j]),
  }));
  const model: GestureClassifier = {
    weights: Array.from({length: classes}, () => new Float32Array(dimensions)),
    bias: new Float32Array(classes),
  };
  const rate = 0.5 / Math.sqrt(dimensions);
  for (let epoch = 0; epoch < 250; epoch++) {
    signal?.throwIfAborted();
    const gradient = model.weights.map(() => new Float64Array(dimensions));
    const bias = new Float64Array(classes);
    for (const {features, target} of normalized) {
      const scores = predictFeatures(model, features);
      for (let k = 0; k < classes; k++) {
        const error =
          (scores[k] - Number(k === target)) / (counts[target] * classes);
        bias[k] += error;
        for (let j = 0; j < dimensions; j++)
          gradient[k][j] += error * features[j];
      }
    }
    for (let k = 0; k < classes; k++) {
      model.bias[k] -= rate * bias[k];
      for (let j = 0; j < dimensions; j++)
        model.weights[k][j] -=
          rate * (gradient[k][j] + 0.001 * model.weights[k][j]);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  for (let k = 0; k < classes; k++) {
    for (let j = 0; j < dimensions; j++) {
      model.weights[k][j] /= scale[j];
      model.bias[k] -= model.weights[k][j] * mean[j];
    }
  }
  if (
    !model.bias.every(Number.isFinite) ||
    model.weights.some((row) => !row.every(Number.isFinite))
  )
    throw new Error('Classifier training produced non-finite weights.');
  return model;
}
