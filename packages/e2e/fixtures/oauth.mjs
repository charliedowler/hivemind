import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

export async function approveAuthorization(ctx, cookie, authorizationUrl) {
  const url = new URL(authorizationUrl);
  assert.equal(url.origin, ctx.url, 'OAuth authorization must stay on the local server');
  const response = await ctx.request(url.href, { cookie });
  assert.ok(response.status === 302 || (response.status === 200 && response.body?.redirect), `Authorization: ${response.status} ${response.text}`);
  const location = new URL(response.headers.get('location') || response.body.url, ctx.url);
  if (location.searchParams.has('code')) return location;
  assert.equal(location.pathname, '/app/consent', `Expected a real consent redirect, got ${location.pathname}`);
  const result = await ctx.request('/api/auth/oauth2/consent', { cookie, body: { accept: true, oauth_query: location.search.slice(1) } });
  assert.equal(result.status, 200, `Consent: ${result.text}`);
  const callback = new URL(result.body.url);
  assert.ok(['localhost', '127.0.0.1'].includes(callback.hostname), 'OAuth callback must stay on loopback');
  assert.ok(callback.searchParams.get('code'), 'Consent must issue an authorization code');
  return callback;
}

export async function oauthToken(ctx, owner, { personWide = false } = {}) {
  const redirectUri = `${ctx.url}/e2e-callback`;
  const scope = `hive${personWide ? ' hive:person' : ''} offline_access`;
  const registration = await ctx.request('/api/auth/oauth2/register', { body: { client_name: 'Hive E2E client', application_type: 'native', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope } });
  assert.equal(registration.status, 201, `Client registration: ${registration.text}`);
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(20).toString('hex');
  const query = new URLSearchParams({ client_id: registration.body.client_id, redirect_uri: redirectUri, response_type: 'code', scope, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, resource: `${ctx.url}/api/mcp` });
  const callback = await approveAuthorization(ctx, owner.cookie, `${ctx.url}/api/auth/oauth2/authorize?${query}`);
  assert.equal(callback.searchParams.get('state'), state);
  const exchange = await ctx.request('/api/auth/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registration.body.client_id, code: callback.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirectUri, resource: `${ctx.url}/api/mcp` }).toString() });
  assert.equal(exchange.status, 200, `PKCE exchange: ${exchange.text}`);
  assert.ok(exchange.body.access_token);
  const claims = JSON.parse(Buffer.from(exchange.body.access_token.split('.')[1], 'base64url').toString());
  assert.equal(String(claims.scope).split(' ').includes('hive:person'), personWide);
  return { ...exchange.body, claims };
}

export async function completeInstallerOAuth(ctx, machine, owner, state) {
  const callback = await approveAuthorization(ctx, owner.cookie, state.url);
  const result = await fetch(callback, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.ok(result.status < 400, `Installer loopback callback failed: ${result.status}`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const stored = JSON.parse(await machine.read('.hive/oauth.json').catch(() => '{}'));
    if (stored.access_token) return stored;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Installer callback did not save its OAuth credential');
}
