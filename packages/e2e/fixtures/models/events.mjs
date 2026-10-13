export async function recordModel(method, input) {
  const sink = process.env.HIVE_E2E_SINK_URL;
  if (!sink) throw new Error('HIVE_E2E_SINK_URL is required by model fixtures');
  const response = await fetch(`${sink}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'model', method, input }),
  });
  if (!response.ok) throw new Error(`Model sink returned ${response.status}`);
}
