import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

type Image = {type: 'image'; data: string; mimeType: string};

export function imageContent(dataUrl: string): Image {
  const match = /^data:(image\/[^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 image data URL.');
  return {type: 'image', mimeType: match[1]!, data: match[2]!};
}

export function toolResult(value: unknown) {
  const images: Image[] = [];
  const json = JSON.stringify(value ?? {completed: true}, (_key, item) => {
    if (typeof item === 'string' && /^data:image\/[^;]+;base64,/.test(item)) {
      const image = imageContent(item);
      images.push(image);
      return {imageIndex: images.length - 1, mimeType: image.mimeType};
    }
    return item;
  });
  const data: unknown = JSON.parse(json);
  const structuredContent =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {result: data};
  return {
    content: [{type: 'text' as const, text: json}, ...images],
    structuredContent,
  };
}

export async function saveImage(out: string, dataUrl: string) {
  const image = imageContent(dataUrl);
  const resolved = path.resolve(out);
  await mkdir(path.dirname(resolved), {recursive: true});
  await writeFile(resolved, Buffer.from(image.data, 'base64'));
  return resolved;
}
