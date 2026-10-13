import { extractiveAnswer } from '../../../../apps/web/src/server/llm/synthesize.ts?hive-e2e-original';
import { recordModel } from './events.mjs';

export { extractiveAnswer } from '../../../../apps/web/src/server/llm/synthesize.ts?hive-e2e-original';

export async function synthesizeAnswer(question, hits, lifecycleContext = '') {
  if (hits.length) await recordModel('synthesizeAnswer', { question, hits, lifecycleContext });
  return extractiveAnswer(hits);
}
