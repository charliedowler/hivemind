import { recordModel } from './events.mjs';

async function storage(operation, input) {
  const response = await fetch(`${process.env.HIVE_E2E_SINK_URL}/blob/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Fixture blob store returned ${response.status}`);
  return response.json();
}

export async function putPrivateObject(key, content, contentType) {
  await recordModel('putPrivateObject', { key, bytes: content.length, contentType });
  await storage('write', { key, content: content.toString('base64') });
}

export async function readPrivateObject(key) {
  await recordModel('readPrivateObject', { key });
  const result = await storage('read', { key });
  if (typeof result.content !== 'string') throw new Error(`Missing fixture object: ${key}`);
  return Buffer.from(result.content, 'base64');
}
