import { randomUUID } from 'node:crypto';

export async function send(topic, body, options = {}) {
  if (topic !== 'hive-slack') throw new Error(`Unexpected test queue: ${topic}`);
  await fetch(`${process.env.HIVE_E2E_SINK_URL}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'queue', topic, body, options }) });
  const response = await fetch(`${process.env.PUBLIC_URL}/api/queues/slack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Local Slack queue callback failed: ${response.status} ${await response.text()}`);
  return { messageId: randomUUID() };
}

export function handleCallback(callback) {
  return async request => {
    try {
      await callback(await request.json(), { deliveryCount: 1 });
      return Response.json({ ok: true });
    } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
  };
}
