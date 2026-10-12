#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { endpoint, saveCredentials } from './mcp.mjs';

function trustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Hive login requires HTTPS');
  return url.href;
}

async function json(url, init = {}) {
  const response = await fetch(trustedUrl(url), { ...init, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`Hive login returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const baseUrl = endpoint();
  const resource = `${baseUrl}/api/mcp`;
  const probe = await fetch(resource, { headers: { Accept: 'application/json, text/event-stream' }, signal: AbortSignal.timeout(5000) });
  const metadataUrl = probe.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1] || `${baseUrl}/.well-known/oauth-protected-resource`;
  await probe.body?.cancel();
  const resourceMetadata = await json(metadataUrl);
  const issuer = resourceMetadata.authorization_servers?.[0];
  if (!issuer) throw new Error('Hive has not enabled OAuth discovery yet');
  const issuerUrl = new URL(trustedUrl(issuer));
  const suffix = issuerUrl.pathname.replace(/\/$/, '');
  let discovery;
  try { discovery = await json(`${issuerUrl.origin}/.well-known/oauth-authorization-server${suffix}`); }
  catch { discovery = await json(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`); }
  if (!discovery.registration_endpoint || !discovery.authorization_endpoint || !discovery.token_endpoint) throw new Error('Hive OAuth discovery is incomplete');
  const scopes = new Set(resourceMetadata.scopes_supported || ['hive']);
  if (discovery.scopes_supported?.includes('offline_access')) scopes.add('offline_access');
  const scope = [...scopes].join(' ');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) { response.writeHead(400).end('This sign-in does not match the hive request.'); return; }
    const code = url.searchParams.get('code');
    if (!code) { response.writeHead(400).end('Hive sign-in did not finish.'); rejectCode(new Error('Hive sign-in was declined')); return; }
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('Your forager is connected. Return to the terminal.');
    resolveCode(code);
  });
  const timeout = setTimeout(() => rejectCode(new Error('Hive sign-in timed out. Run gohive login to retry.')), 120000);
  codePromise.catch(() => {});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const registration = await json(discovery.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Hive hooks', application_type: 'native', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope }) });
    if (!registration.client_id) throw new Error('Hive did not register the hook client');
    const authorizationUrl = new URL(trustedUrl(discovery.authorization_endpoint));
    authorizationUrl.search = new URLSearchParams({ client_id: registration.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state, resource, scope }).toString();
    console.log('Let the hooks catch up with your hive. Open this sign-in link:');
    console.log(authorizationUrl.href);
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', authorizationUrl.href] : [authorizationUrl.href];
    if (process.env.HIVE_NO_BROWSER !== '1') {
      const browser = spawn(command, args, { stdio: 'ignore' });
      browser.on('error', () => {});
    }
    const code = await codePromise;
    const tokens = await json(discovery.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: registration.client_id, redirect_uri: redirectUri, resource }) });
    if (!tokens.access_token) throw new Error('Hive did not return a token');
    saveCredentials({ ...tokens, baseUrl, client_id: registration.client_id, token_endpoint: trustedUrl(discovery.token_endpoint), expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 });
    console.log('The hooks can now read your hive. Run gohive doctor to check your foragers.');
  } finally { clearTimeout(timeout); server.closeAllConnections(); server.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
