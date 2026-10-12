import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bearerToken } from '../../../skills/hive/scripts/mcp.mjs';

const loginScript = fileURLToPath(new URL('../../../skills/hive/scripts/login.mjs', import.meta.url));

test('the hook OAuth login discovers the server, uses PKCE and saves a private refreshable token', async t => {
  let baseUrl;
  let redirectUri;
  let challenge;
  let refreshes = 0;
  const server = createServer(async (request, response) => {
    const send = value => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (request.url === '/api/mcp') { response.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/resource"` }).end(); return; }
    if (request.url === '/resource') { send({ resource: `${baseUrl}/api/mcp`, authorization_servers: [baseUrl], scopes_supported: ['hive'] }); return; }
    if (request.url === '/.well-known/oauth-authorization-server') { send({ issuer: baseUrl, registration_endpoint: `${baseUrl}/register`, authorization_endpoint: `${baseUrl}/authorize`, token_endpoint: `${baseUrl}/token` }); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.url === '/register') {
      const client = JSON.parse(body);
      assert.equal(client.token_endpoint_auth_method, 'none');
      redirectUri = client.redirect_uris[0];
      assert.ok(redirectUri.startsWith('http://127.0.0.1:'));
      send({ client_id: 'hook-client' }); return;
    }
    if (request.url === '/token') {
      const params = new URLSearchParams(body);
      assert.equal(params.get('client_id'), 'hook-client');
      if (params.get('grant_type') === 'refresh_token') { refreshes++; assert.equal(params.get('refresh_token'), 'fixture-refresh'); send({ access_token: 'refreshed-token', expires_in: 3600 }); return; }
      assert.equal(params.get('redirect_uri'), redirectUri);
      assert.equal(params.get('resource'), `${baseUrl}/api/mcp`);
      assert.equal(params.get('code'), 'fixture-code');
      assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), challenge);
      send({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 1 }); return;
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  const home = mkdtempSync(join(tmpdir(), 'gohive-oauth-'));
  const child = spawn(process.execPath, [loginScript], { env: { ...process.env, HOME: home, HIVE_HOME: home, HIVE_URL: baseUrl, HIVE_NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let signedIn = false;
  child.stderr.on('data', chunk => stderr += chunk);
  const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code ? reject(new Error(stderr)) : resolve()); });
  child.stdout.on('data', async chunk => {
    stdout += chunk;
    const link = stdout.split('\n').find(line => line.startsWith(`${baseUrl}/authorize?`));
    if (!link || signedIn) return;
    signedIn = true;
    const authorize = new URL(link);
    challenge = authorize.searchParams.get('code_challenge');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(redirectUri);
    callback.search = new URLSearchParams({ state: 'wrong-state', code: 'fixture-code' }).toString();
    assert.equal((await fetch(callback)).status, 400);
    callback.searchParams.set('state', authorize.searchParams.get('state'));
    assert.equal((await fetch(callback)).status, 200);
  });
  await completed;
  assert.ok(signedIn);
  const credentials = join(home, '.hive/oauth.json');
  const stored = JSON.parse(readFileSync(credentials, 'utf8'));
  assert.equal(stored.access_token, 'fixture-access');
  assert.equal(statSync(credentials).mode & 0o777, 0o600);
  assert.equal(await bearerToken(home, baseUrl, AbortSignal.timeout(1000)), 'refreshed-token');
  assert.equal(refreshes, 1);
  assert.ok(!stdout.includes('fixture-access'));
  assert.ok(!stdout.includes('fixture-refresh'));
});
