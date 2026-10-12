import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportEvent, reportDoctors } from '../../../skills/hive/scripts/telemetry.mjs';

async function fixture(t, respond = true) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
    if (respond) response.writeHead(204).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('doctor reports use the OAuth store, fixed metadata and separate attempt identities', async t => {
  const hive = await fixture(t);
  const home = mkdtempSync(join(tmpdir(), 'gohive-telemetry-'));
  mkdirSync(join(home, '.hive'));
  writeFileSync(join(home, '.hive/oauth.json'), JSON.stringify({ baseUrl: hive.baseUrl, access_token: 'fixture-oauth', expires_at: Date.now() + 3600000 }));
  const previous = process.env.HIVE_URL;
  process.env.HIVE_URL = hive.baseUrl;
  t.after(() => { if (previous === undefined) delete process.env.HIVE_URL; else process.env.HIVE_URL = previous; });
  assert.deepEqual(await reportDoctors([{ agent: 'claude', healthy: true }, { agent: 'codex', healthy: false }, { agent: 'executor', healthy: true }], home), [true, true, true]);
  assert.deepEqual(hive.requests.map(({ body }) => [body.agent, body.outcome]), [['claude-code', 'completed'], ['codex', 'failed'], ['executor', 'completed']]);
  assert.equal(new Set(hive.requests.map(({ body }) => body.attemptId)).size, 3);
  for (const request of hive.requests) {
    assert.equal(request.path, '/api/analytics/install');
    assert.equal(request.authorization, 'Bearer fixture-oauth');
    assert.deepEqual(Object.keys(request.body).sort(), ['agent', 'attemptId', 'outcome', 'platform', 'step']);
    assert.equal(request.body.step, 'doctor');
    assert.ok(!JSON.stringify(request.body).includes(home));
  }
});

test('hook reports strip extra data and keep unknown push counts null', async t => {
  const hive = await fixture(t);
  assert.equal(await reportEvent('hook', { hookKind: 'session_start', gateDecision: 'skip', transcript: 'private text', repo: '/private/repo' }, { baseUrl: hive.baseUrl, token: 'fixture' }), true);
  const body = hive.requests[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['attemptId', 'gateDecision', 'hookKind', 'pushedCount']);
  assert.equal(body.pushedCount, null);
  assert.match(body.attemptId, /^[0-9a-f-]{36}$/);
});

test('telemetry failure is bounded and never retries a report', async t => {
  const hive = await fixture(t, false);
  const start = performance.now();
  assert.equal(await reportEvent('hook', { hookKind: 'stop', gateDecision: 'capture' }, { baseUrl: hive.baseUrl, token: 'fixture' }), false);
  assert.ok(performance.now() - start < 2000);
  assert.equal(hive.requests.length, 1);
});
