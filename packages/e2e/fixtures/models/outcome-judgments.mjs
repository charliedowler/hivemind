import { decideOutcome } from '../../../../apps/web/src/server/outcome-judgments.ts?hive-e2e-original';
import { recordModel } from './events.mjs';
import { synthetic } from './data.mjs';

export { decideOutcome, outcomeSignalsSchema } from '../../../../apps/web/src/server/outcome-judgments.ts?hive-e2e-original';

export async function classifyOutcome(cell, outcome, evidence) {
  await recordModel('classifyOutcome', { cell, outcome, evidence });
  const choice = ['useful', 'contradicted', 'stale', 'inconclusive'].find(kind => outcome === synthetic[kind]) ?? 'inconclusive';
  const signals = { result: { type: 'choice', choice, confidence: 1 }, supported: { type: 'noul', noul: choice === 'inconclusive' ? 0 : 1 } };
  return { classification: decideOutcome(signals), judgment: { model: 'e2e-outcome', signals } };
}
