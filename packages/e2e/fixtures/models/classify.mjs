import { decide, capturePreGate } from '../../../../apps/web/src/server/classify.ts?hive-e2e-original';
import { recordModel } from './events.mjs';
import { synthetic } from './data.mjs';

export { jevModel, repoAreas, pushQuestions, captureQuestions, askQuestions, classificationJson, frictionAreaForTopic, decide, capturePreGate } from '../../../../apps/web/src/server/classify.ts?hive-e2e-original';

export async function classifyPush(input) {
  await recordModel('classifyPush', input);
  const kind = input.kind ?? (input.body.includes(synthetic.observation) ? 'friction' : 'learning');
  const answers = {
    kind: { type: 'choice', choice: kind, confidence: 1, probabilities: { [kind]: 1 } },
    worthSharing: { type: 'noul', noul: 1 },
    sensitive: { type: 'noul', noul: 0 },
    repoArea: { type: 'choice', choice: 'tooling', confidence: 1, probabilities: { tooling: 1 } },
    severity: { type: 'score', score: 2, confidence: 1, probabilities: { 2: 1 }, legend: {} },
  };
  return { classification: { model: 'e2e-classifier', latencyMs: 0, answers }, decision: decide({ point: 'push', callerKind: input.kind, answers }) };
}

export async function classifyCapture(facts) {
  if (!capturePreGate(facts)) return { decision: 'skip', classification: null };
  await recordModel('classifyCapture', facts);
  return { decision: decide({ point: 'capture', facts, probability: 1 }), classification: { model: 'e2e-classifier', latencyMs: 0, answers: { worthSharing: { type: 'noul', noul: 1 } } } };
}

export async function classifyAsk(question, hits) {
  if (hits.length) await recordModel('classifyAsk', { question, hits });
  return { decision: decide({ point: 'ask', question, hits, probability: hits.length ? 1 : null }), classification: null };
}
