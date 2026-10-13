import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('assets/hive/scripts/doctor.mjs');
function run(home, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, HOME: home, HIVE_HOME: home, HIVE_KEY: '', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', status => resolve({ status, output }));
  });
}

test('hook doctor verifies the live capability and rejects expired or revoked tokens', async () => {
  const server = createServer(async (request, response) => {
    if (request.url === '/token' || request.headers.authorization !== 'Bearer fixture-valid') { response.writeHead(401).end(); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } : { content: [{ type: 'text', text: 'No cells' }] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const home = mkdtempSync(join(tmpdir(), 'gohive-doctor-'));
  mkdirSync(join(home, '.hive'));
  try {
    for (const [token, expiry, expected] of [['fixture-valid', Date.now() + 60000, 0], ['fixture-expired', Date.now() - 1, 1], ['fixture-revoked', Date.now() + 60000, 1]]) {
      writeFileSync(join(home, '.hive/oauth.json'), JSON.stringify({ baseUrl, access_token: token, expires_at: expiry, refresh_token: 'fixture-refresh', token_endpoint: `${baseUrl}/token`, client_id: 'fixture' }));
      const result = await run(home, ['--hooks'], { HIVE_URL: baseUrl });
      assert.equal(result.status, expected);
      assert.equal(result.output, '');
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Codex doctor requires authenticated tool discovery instead of an enabled configuration', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gohive-codex-doctor-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const cli = `#!${process.execPath}
import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (!message.id) continue;
  const result = message.method === 'initialize' ? {} : { data: [{ name: 'hive', authStatus: 'oAuth', toolsError: process.env.FIXTURE_HEALTH === 'yes' ? null : 'Unauthorized', tools: process.env.FIXTURE_HEALTH === 'yes' ? { search: { name: 'hive_search' }, push: { name: 'hive_push' } } : {} }] };
  console.log(JSON.stringify({ id: message.id, result }));
}
`;
  writeFileSync(join(bin, 'codex'), cli, { mode: 0o700 });
  for (const [health, expected] of [['yes', 0], ['no', 1]]) {
    const result = await run(home, ['--codex'], { PATH: `${bin}:${process.env.PATH}`, FIXTURE_HEALTH: health });
    assert.equal(result.status, expected);
    assert.equal(result.output, '');
  }
});
