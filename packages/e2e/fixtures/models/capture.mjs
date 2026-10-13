import { decideCaptureDetails } from '../../../../apps/web/src/server/llm/capture.ts?hive-e2e-original';
import { recordModel } from './events.mjs';
import { synthetic } from './data.mjs';

export { evidenceText, cleanEvidence, captureDetailsSchema, decideCaptureDetails } from '../../../../apps/web/src/server/llm/capture.ts?hive-e2e-original';

export async function deriveCaptureDetails(observation, evidence) {
  await recordModel('deriveCaptureDetails', { observation, evidence });
  const measured = evidence.includes(synthetic.measured);
  const estimated = evidence.includes(synthetic.estimated);
  return decideCaptureDetails(observation, evidence, {
    title: observation.includes(synthetic.observation) ? synthetic.title : observation.slice(0, 200),
    blocked: measured ? true : null,
    blockedCitation: measured ? 'The build was blocked.' : null,
    workaround: measured ? 'Regenerating the client' : null,
    workaroundCitation: measured ? 'Regenerating the client fixed the build.' : null,
    cost: measured || estimated ? 12 : null,
    costCitation: measured ? '12 minutes lost' : estimated ? '12 minutes' : null,
  });
}
