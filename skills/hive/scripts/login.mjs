#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { endpoint, saveCredentials } from './mcp.mjs';
import { updateSignIn } from './sign-in-state.mjs';

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
  const background = Boolean(process.env.HIVE_SIGN_IN_ATTEMPT);
  if (background) updateSignIn({ pid: process.pid });
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
  let callbackResponse;
  let received = false;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) { response.writeHead(400).end('This sign-in does not match the hive request.'); return; }
    const code = url.searchParams.get('code');
    if (!code) { response.writeHead(400).end('Hive sign-in did not finish.'); rejectCode(new Error('Hive sign-in was declined')); return; }
    if (received) { response.writeHead(409).end('Sign-in is already finishing. Run npx gohive status.'); return; }
    received = true;
    callbackResponse = response;
    if (background) updateSignIn({ phase: 'exchanging' });
    resolveCode(code);
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 15000;
  const timeout = setTimeout(() => rejectCode(new Error('Hive sign-in timed out. Run gohive login to retry.')), background ? 600000 : 120000);
  let approval;
  codePromise.catch(() => {});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    server.ref();
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const registration = await json(discovery.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Hive hooks', application_type: 'native', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope }) });
    if (!registration.client_id) throw new Error('Hive did not register the hook client');
    const authorizationUrl = new URL(trustedUrl(discovery.authorization_endpoint));
    authorizationUrl.search = new URLSearchParams({ client_id: registration.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state, resource, scope }).toString();
    const loginUrl = process.env.HIVE_IDENTITY === 'agent' ? new URL('/api/auth/agentid/start', baseUrl) : authorizationUrl;
    if (process.env.HIVE_IDENTITY === 'agent') {
      loginUrl.search = authorizationUrl.search;
      if (process.env.HIVE_AGENT_INBOX) loginUrl.searchParams.set('login_hint', process.env.HIVE_AGENT_INBOX);
      if (process.env.HIVE_AGENT_NAME) loginUrl.searchParams.set('agent_name', process.env.HIVE_AGENT_NAME);
      if (!background) approval = setTimeout(() => console.log(process.env.HIVE_AGENT_INBOX
        ? `If AgentID is waiting, run agentmail inboxes authorize --inbox-id ${process.env.HIVE_AGENT_INBOX} --auth-token <token shown at https://auth.agentid.com>`
        : 'If AgentID is waiting, choose an inbox you control and run the approval command shown at https://auth.agentid.com'), 5000);
    }
    if (!background) console.log(`Open ${loginUrl.href}`);
    if (background) updateSignIn({ phase: 'waiting', url: loginUrl.href });
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', loginUrl.href] : [loginUrl.href];
    if (process.env.HIVE_NO_BROWSER !== '1') {
      const browser = spawn(command, args, { stdio: 'ignore' });
      browser.on('error', () => {});
    }
    const code = await codePromise;
    const tokens = await json(discovery.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: registration.client_id, redirect_uri: redirectUri, resource }) });
    if (!tokens.access_token) throw new Error('Hive did not return a token');
    if (background) updateSignIn({ phase: 'exchanging' });
    saveCredentials({ ...tokens, baseUrl, client_id: registration.client_id, token_endpoint: trustedUrl(discovery.token_endpoint), expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 });
    if (background) updateSignIn({ phase: 'connected', url: undefined });
    callbackResponse.writeHead(200, { 'Content-Type': 'text/plain' }).end('Hive is connected. Return to your agent and run npx gohive status.');
    if (background) {
      if (process.env.HIVE_NATIVE_CODEX === '1') await nativeLogin();
    }
    if (!background) console.log('The hooks can now read your hive. Run gohive doctor to check your foragers.');
  } catch (error) {
    if (callbackResponse && !callbackResponse.headersSent) callbackResponse.writeHead(502, { 'Content-Type': 'text/plain' }).end('Hive could not finish sign-in. Return to your agent and run npx gohive status.');
    throw error;
  } finally { clearTimeout(timeout); clearTimeout(approval); server.close(); }
}
async function nativeLogin() {
  await new Promise(resolve => {
    updateSignIn({ phase: 'native-waiting', url: undefined });
    const child = spawn('codex', ['mcp', 'login', 'hive'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const read = chunk => {
      output = (output + chunk.toString()).slice(-10000);
      for (const match of output.matchAll(/https?:\/\/[^\s<>]+/g)) {
        try { const url = new URL(match[0]); if (url.origin === new URL(endpoint()).origin && url.pathname.includes('authorize')) updateSignIn({ phase: 'native-waiting', url: url.href }); } catch {}
      }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    const timer = setTimeout(() => child.kill(), 600000);
    child.on('error', () => { clearTimeout(timer); updateSignIn({ phase: 'native-incomplete' }); resolve(); });
    child.on('exit', code => { clearTimeout(timer); updateSignIn({ phase: code === 0 ? 'connected' : 'native-incomplete', url: undefined }); resolve(); });
  });
}
main().catch(error => {
  if (process.env.HIVE_SIGN_IN_ATTEMPT) { try { updateSignIn({ phase: 'failed', url: undefined }); } catch {} }
  if (!process.env.HIVE_SIGN_IN_ATTEMPT) console.error(error.message); process.exitCode = 1;
});
