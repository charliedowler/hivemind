import { excludedFromRetrieval } from '../../../../packages/core/src/index.ts';
import { recordModel } from './events.mjs';

export async function judgeMemory(input, candidates) {
  await recordModel('judgeMemory', { input, candidates });
  return { relations: candidates.map(candidate => ({ id: candidate.id, revision: candidate.revision, relation: candidate.body === input.body ? 'same' : 'unrelated', confidence: 1 })), tags: [] };
}

export async function rerankMemory(question, hits, options = {}) {
  const eligible = hits.filter(hit => options.includeHistory || !excludedFromRetrieval(hit));
  if (eligible.length) await recordModel('rerankMemory', { question, hits: eligible, options });
  return eligible;
}
