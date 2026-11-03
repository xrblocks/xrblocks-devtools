import {loadAndCompile, Tensor} from '@litertjs/core';
import type {CompiledModel} from '@litertjs/core';
import {HAND_JOINT_NAMES} from '../hands/types.js';
import type {HandJointName, PhysicalHand} from '../hands/types.js';
import {HAND_FEATURE_SIZES, handFeatures} from './features.js';
import type {HandPoint} from './features.js';
import {gestureManifestSchema} from './schema.js';
import type {GestureManifest} from './schema.js';

export class TFLiteGestureRecognizer {
  private disposed = false;
  private pending = Promise.resolve();

  private constructor(
    private readonly model: CompiledModel,
    private readonly manifest: GestureManifest
  ) {}

  static async load(modelUrl: string, manifestUrl: string) {
    const [response, metadata] = await Promise.all([
      fetch(modelUrl),
      fetch(manifestUrl),
    ]);
    if (!response.ok || !metadata.ok)
      throw new Error(
        `Failed to load gesture model: ${response.status}/${metadata.status}.`
      );
    const manifest = gestureManifestSchema.parse(await metadata.json());
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.length > 1024 * 1024 ||
      new TextDecoder().decode(bytes.subarray(4, 8)) !== 'TFL3'
    )
      throw new Error('Invalid gesture TFLite file.');
    const model = await loadAndCompile(bytes, {accelerator: 'wasm'});
    try {
      const inputs = model.getInputDetails();
      const outputs = model.getOutputDetails();
      if (
        inputs.length !== 1 ||
        outputs.length !== 1 ||
        inputs[0].dtype !== 'float32' ||
        outputs[0].dtype !== 'float32' ||
        JSON.stringify(Array.from(inputs[0].shape)) !==
          JSON.stringify([1, HAND_FEATURE_SIZES[manifest.features]]) ||
        JSON.stringify(Array.from(outputs[0].shape)) !==
          JSON.stringify([1, manifest.labels.length])
      ) {
        throw new Error(
          `Gesture model tensors do not match the manifest: ${JSON.stringify({inputs, outputs})}`
        );
      }
      return new TFLiteGestureRecognizer(model, manifest);
    } catch (error) {
      model.delete();
      throw error;
    }
  }

  getGestureConfigurations() {
    return Object.fromEntries(
      this.manifest.labels
        .filter((label) => label !== 'other')
        .map((label) => [label, {enabled: true}])
    );
  }

  recognize(context: {
    handLabel: PhysicalHand;
    getJoint(name: HandJointName): HandPoint | undefined;
  }): Promise<Record<string, {confidence: number}>> {
    if (this.disposed)
      return Promise.reject(new Error('Gesture recognizer is disposed.'));
    const points = HAND_JOINT_NAMES.map((name) => context.getJoint(name));
    const features = points.every((point) => point !== undefined)
      ? handFeatures(points, context.handLabel, this.manifest.features)
      : null;
    if (!features) return Promise.resolve({});
    const run = this.pending.then(async () => {
      const input = new Tensor(features, [1, features.length]);
      let outputs: Tensor[] = [];
      try {
        outputs = await this.model.run([input]);
        const scores = await outputs[0].data();
        const best = scores.indexOf(Math.max(...scores));
        if (
          !scores.every(Number.isFinite) ||
          scores[best] < this.manifest.threshold ||
          this.manifest.labels[best] === 'other'
        )
          return {};
        return {[this.manifest.labels[best]]: {confidence: scores[best]}};
      } finally {
        outputs.forEach((tensor) => tensor.delete());
        input.delete();
      }
    });
    this.pending = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    void this.pending.then(() => this.model.delete());
  }
}

export {handFeatures, HAND_FEATURE_SIZES} from './features.js';
export type {HandPoint, HandFeatureFormat} from './features.js';
export type {GestureManifest} from './schema.js';
