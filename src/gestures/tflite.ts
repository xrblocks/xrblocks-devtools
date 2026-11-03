import {Builder} from 'flatbuffers';
import {HAND_FEATURE_SIZE} from './features.js';
import type {GestureClassifier} from './classifier.js';
import type {GestureManifest} from './schema.js';
import {gestureManifestSchema} from './schema.js';

type Field = [number, 'offset' | 'int' | 'byte' | 'float', number];

export function encodeTFLite(
  model: GestureClassifier,
  manifest: GestureManifest
) {
  const builder = new Builder(4096);
  const table = (size: number, fields: Field[] = []) => {
    builder.startObject(size);
    for (const [slot, type, value] of fields) {
      if (type === 'offset') builder.addFieldOffset(slot, value, 0);
      else if (type === 'byte') builder.addFieldInt8(slot, value, 0);
      else if (type === 'float') builder.addFieldFloat32(slot, value, 0);
      else builder.addFieldInt32(slot, value, 0);
    }
    return builder.endObject();
  };
  const vector = (values: number[], offsets = false) => {
    builder.startVector(4, values.length, 4);
    for (let i = values.length - 1; i >= 0; i--) {
      if (offsets) builder.addOffset(values[i]);
      else builder.addInt32(values[i]);
    }
    return builder.endVector();
  };
  const buffers = [table(3)];
  const buffer = (bytes: Uint8Array) => {
    builder.startVector(1, bytes.length, 16);
    for (let i = bytes.length - 1; i >= 0; i--) builder.addInt8(bytes[i]);
    buffers.push(table(3, [[0, 'offset', builder.endVector()]]));
    return buffers.length - 1;
  };
  const tensors: number[] = [];
  const tensor = (name: string, shape: number[], values?: number[]) => {
    let bufferIndex = 0;
    if (values) {
      const bytes = new Uint8Array(values.length * 4);
      const view = new DataView(bytes.buffer);
      values.forEach((value, i) => {
        if (!Number.isFinite(Math.fround(value)))
          throw new Error('TFLite weights must fit float32.');
        view.setFloat32(i * 4, value, true);
      });
      bufferIndex = buffer(bytes);
    }
    tensors.push(
      table(10, [
        [0, 'offset', vector(shape)],
        [2, 'int', bufferIndex],
        [3, 'offset', builder.createString(name)],
        [8, 'byte', 1],
      ])
    );
    return tensors.length - 1;
  };
  const classes = manifest.labels.length;
  const features = tensor('features', [1, HAND_FEATURE_SIZE]);
  const weights = tensor(
    'weights',
    [classes, HAND_FEATURE_SIZE],
    model.weights.flatMap((row) => Array.from(row))
  );
  const bias = tensor('bias', [classes], Array.from(model.bias));
  const logits = tensor('logits', [1, classes]);
  const scores = tensor('scores', [1, classes]);
  const codes = [9, 25].map((code) =>
    table(4, [
      [0, 'byte', code],
      [2, 'int', 1],
      [3, 'int', code],
    ])
  );
  const denseOptions = table(5);
  const dense = table(14, [
    [1, 'offset', vector([features, weights, bias])],
    [2, 'offset', vector([logits])],
    [3, 'byte', 8],
    [4, 'offset', denseOptions],
  ]);
  const softmaxOptions = table(1, [[0, 'float', 1]]);
  const softmax = table(14, [
    [0, 'int', 1],
    [1, 'offset', vector([logits])],
    [2, 'offset', vector([scores])],
    [3, 'byte', 9],
    [4, 'offset', softmaxOptions],
  ]);
  const graph = table(6, [
    [0, 'offset', vector(tensors, true)],
    [1, 'offset', vector([features])],
    [2, 'offset', vector([scores])],
    [3, 'offset', vector([dense, softmax], true)],
    [4, 'offset', builder.createString('hand_gestures')],
  ]);
  const tensorMap = (name: string, index: number) =>
    table(2, [
      [0, 'offset', builder.createString(name)],
      [1, 'int', index],
    ]);
  const signature = table(5, [
    [0, 'offset', vector([tensorMap('features', features)], true)],
    [1, 'offset', vector([tensorMap('scores', scores)], true)],
    [2, 'offset', builder.createString('serving_default')],
  ]);
  const metadataBuffer = buffer(
    new TextEncoder().encode(JSON.stringify(manifest))
  );
  const metadata = table(2, [
    [0, 'offset', builder.createString('xrblocks-hand-gestures')],
    [1, 'int', metadataBuffer],
  ]);
  const root = table(8, [
    [0, 'int', 3],
    [1, 'offset', vector(codes, true)],
    [2, 'offset', vector([graph], true)],
    [
      3,
      'offset',
      builder.createString('XR Blocks Devtools hand gesture classifier'),
    ],
    [4, 'offset', vector(buffers, true)],
    [6, 'offset', vector([metadata], true)],
    [7, 'offset', vector([signature], true)],
  ]);
  builder.finish(root, 'TFL3');
  return builder.asUint8Array().slice();
}

export function decodeTFLite(bytes: Uint8Array) {
  const invalid = () =>
    new Error('Unsupported or invalid Devtools hand-gesture TFLite model.');
  if (
    bytes.length < 8 ||
    bytes.length > 1024 * 1024 ||
    new TextDecoder().decode(bytes.subarray(4, 8)) !== 'TFL3'
  )
    throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (offset: number, length: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset + length > bytes.length
    )
      throw invalid();
  };
  const i32 = (offset: number) => {
    check(offset, 4);
    return view.getInt32(offset, true);
  };
  const u16 = (offset: number) => {
    check(offset, 2);
    return view.getUint16(offset, true);
  };
  const field = (table: number, slot: number) => {
    const vtable = table - i32(table);
    const size = u16(vtable);
    if (size < 4 || size % 2 !== 0) throw invalid();
    check(vtable, size);
    const objectSize = u16(vtable + 2);
    check(table, objectSize);
    const position = slot * 2 + 4;
    const offset = position + 2 <= size ? u16(vtable + position) : 0;
    if (offset && (offset < 4 || offset >= objectSize)) throw invalid();
    return offset ? table + offset : 0;
  };
  const vector = (table: number, slot: number, width: number, max: number) => {
    const f = field(table, slot);
    if (!f) return {start: 0, length: 0};
    const target = f + i32(f);
    const length = i32(target);
    if (length < 0 || length > max) throw invalid();
    check(target + 4, length * width);
    return {start: target + 4, length};
  };
  const tables = (table: number, slot: number, max: number) => {
    const {start, length} = vector(table, slot, 4, max);
    return Array.from({length}, (_, index) => {
      const offset = start + index * 4;
      return offset + i32(offset);
    });
  };
  const numbers = (table: number, slot: number) => {
    const {start, length} = vector(table, slot, 4, HAND_FEATURE_SIZE);
    return Array.from({length}, (_, index) => i32(start + index * 4));
  };
  const data = (table: number, slot: number) => {
    const {start, length} = vector(table, slot, 1, bytes.length);
    return bytes.subarray(start, start + length);
  };
  const string = (table: number, slot: number) =>
    new TextDecoder('utf-8', {fatal: true}).decode(data(table, slot));
  const scalar = (table: number, slot: number) => {
    const f = field(table, slot);
    return f ? i32(f) : 0;
  };
  const byte = (table: number, slot: number) => {
    const f = field(table, slot);
    if (!f) return 0;
    check(f, 1);
    return view.getUint8(f);
  };
  const indirect = (table: number, slot: number) => {
    const f = field(table, slot);
    if (!f) throw invalid();
    return f + i32(f);
  };
  const same = (actual: number[], expected: number[]) => {
    if (
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    )
      throw invalid();
  };
  const root = i32(0);
  if (root < 8 || scalar(root, 0) !== 3) throw invalid();
  const buffers = tables(root, 4, 8);
  const metadata = tables(root, 6, 8).filter(
    (table) => string(table, 0) === 'xrblocks-hand-gestures'
  );
  if (metadata.length !== 1) throw invalid();
  const metadataBuffer = buffers[scalar(metadata[0], 1)];
  if (metadataBuffer === undefined) throw invalid();
  const manifest = gestureManifestSchema.parse(
    JSON.parse(string(metadataBuffer, 0))
  );
  const graphs = tables(root, 2, 1);
  if (graphs.length !== 1) throw invalid();
  const graph = graphs[0];
  const signatures = tables(root, 7, 1);
  if (
    signatures.length !== 1 ||
    string(signatures[0], 2) !== 'serving_default' ||
    scalar(signatures[0], 4) !== 0 ||
    data(buffers[0], 0).length
  )
    throw invalid();
  const inputMaps = tables(signatures[0], 0, 1);
  const outputMaps = tables(signatures[0], 1, 1);
  if (
    inputMaps.length !== 1 ||
    outputMaps.length !== 1 ||
    string(inputMaps[0], 0) !== 'features' ||
    scalar(inputMaps[0], 1) !== 0 ||
    string(outputMaps[0], 0) !== 'scores' ||
    scalar(outputMaps[0], 1) !== 4
  )
    throw invalid();
  const tensors = tables(graph, 0, 5);
  const codes = tables(root, 1, 2);
  const operators = tables(graph, 3, 2);
  if (tensors.length !== 5 || codes.length !== 2 || operators.length !== 2)
    throw invalid();
  same(numbers(graph, 1), [0]);
  same(numbers(graph, 2), [4]);
  [9, 25].forEach((code, index) => {
    if (
      scalar(codes[index], 3) !== code ||
      scalar(codes[index], 2) !== 1 ||
      scalar(operators[index], 0) !== index ||
      byte(operators[index], 3) !== [8, 9][index]
    )
      throw invalid();
  });
  same(numbers(operators[0], 1), [0, 1, 2]);
  same(numbers(operators[0], 2), [3]);
  same(numbers(operators[1], 1), [3]);
  same(numbers(operators[1], 2), [4]);
  const denseOptions = indirect(operators[0], 4);
  if (
    byte(denseOptions, 0) ||
    byte(denseOptions, 1) ||
    byte(denseOptions, 2) ||
    byte(denseOptions, 3) ||
    byte(denseOptions, 4)
  )
    throw invalid();
  const beta = field(indirect(operators[1], 4), 0);
  check(beta, 4);
  if (!beta || view.getFloat32(beta, true) !== 1) throw invalid();
  const classes = manifest.labels.length;
  const shapes = [
    [1, HAND_FEATURE_SIZE],
    [classes, HAND_FEATURE_SIZE],
    [classes],
    [1, classes],
    [1, classes],
  ];
  const names = ['features', 'weights', 'bias', 'logits', 'scores'];
  tensors.forEach((tensor, index) => {
    same(numbers(tensor, 0), shapes[index]);
    if (
      string(tensor, 3) !== names[index] ||
      byte(tensor, 1) !== 0 ||
      byte(tensor, 5) !== 0 ||
      field(tensor, 4) ||
      field(tensor, 6) ||
      field(tensor, 7)
    )
      throw invalid();
    const bufferIndex = scalar(tensor, 2);
    if (
      buffers[bufferIndex] === undefined ||
      ([0, 3, 4].includes(index) && bufferIndex !== 0)
    )
      throw invalid();
  });
  const floats = (tensor: number, length: number) => {
    const content = data(buffers[scalar(tensor, 2)], 0);
    if (content.length !== length * 4) throw invalid();
    const values = new DataView(
      content.buffer,
      content.byteOffset,
      content.byteLength
    );
    const result = Float32Array.from({length}, (_, index) =>
      values.getFloat32(index * 4, true)
    );
    if (!result.every(Number.isFinite)) throw invalid();
    return result;
  };
  const weights = floats(tensors[1], classes * HAND_FEATURE_SIZE);
  const classifier: GestureClassifier = {
    weights: manifest.labels.map((_, index) =>
      weights.slice(index * HAND_FEATURE_SIZE, (index + 1) * HAND_FEATURE_SIZE)
    ),
    bias: floats(tensors[2], classes),
  };
  return {manifest, classifier};
}
