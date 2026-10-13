import { recordModel } from './events.mjs';

export async function suggestTags(learning) {
  await recordModel('suggestTags', learning);
  return ['synthetic-fixture'];
}
