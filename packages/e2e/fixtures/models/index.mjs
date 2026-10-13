import { fileURLToPath } from 'node:url';

export const originalQuery = 'hive-e2e-original';
export const modelFixtures = Object.fromEntries([
  'classify', 'capture-categories', 'memory-judgments', 'outcome-judgments', 'blob-store',
  'llm/embeddings', 'llm/tagger', 'llm/synthesize', 'llm/capture',
].map(name => [`server/${name}.ts`, fileURLToPath(new URL(`${name.split('/').at(-1)}.mjs`, import.meta.url))]));

export default modelFixtures;
