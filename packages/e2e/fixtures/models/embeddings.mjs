import { createHash } from 'node:crypto';
import { recordModel } from './events.mjs';

export const embeddingDimensions = 1536;

export async function embedText(text) {
  await recordModel('embedText', { text });
  const vector = Array(embeddingDimensions).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const digest = createHash('sha256').update(word).digest();
    vector[digest.readUInt32LE(0) % embeddingDimensions] += digest[4] % 2 ? 1 : -1;
  }
  const norm = Math.hypot(...vector);
  return norm ? vector.map(value => value / norm) : null;
}
