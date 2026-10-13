import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function mailFor(ctx, email) {
  return ctx.events.filter(event => event.kind === 'mail' && [event.body?.to].flat().some(to => String(to).toLowerCase() === email.toLowerCase()));
}

function check(response, status, step) {
  assert.equal(response.status, status, `${step}: ${response.status} ${response.text}`);
  return response.body;
}

function browserHeaders(ctx) {
  return { origin: new URL(ctx.url).origin, 'content-type': 'application/json' };
}

async function identity(ctx, email, cookie) {
  assert.ok(cookie, `No browser session cookie for ${email}`);
  const rows = await ctx.sql`SELECT m.id, m.email_verified, m.provisional, t.id AS team_id FROM members m JOIN teams t ON t.personal_owner_member_id = m.id WHERE lower(m.email) = ${email.toLowerCase()}`;
  assert.equal(rows.length, 1, `Expected one human and personal hive for ${email}`);
  assert.equal(rows[0].email_verified, true, 'The human must be email verified');
  assert.equal(rows[0].provisional, false, 'The human must be claimed');
  return { memberId: rows[0].id, teamId: rows[0].team_id, cookie };
}

export async function human(ctx, { email, name = 'Example Person', domain }) {
  if (domain) assert.equal(email.split('@')[1], domain, 'Fixture domain must match email');
  const password = `Example-password-${randomUUID()}!`;
  const start = ctx.events.length;
  check(await ctx.request('/api/auth/sign-up/email', {
    method: 'POST', headers: browserHeaders(ctx), body: { email, name, password },
  }), 200, 'Human signup');
  const verificationMail = mailFor({ events: ctx.events.slice(start) }, email).find(event => /Enter this code in Hive:/.test(event.body.text));
  assert.ok(verificationMail, `Signup must deliver a verification email to ${email}`);
  const otp = /Enter this code in Hive:\s*(\d+)/.exec(verificationMail.body.text)?.[1];
  assert.ok(otp, 'Verification mail must contain a numeric code');
  check(await ctx.request('/api/auth/email-otp/verify-email', {
    method: 'POST', headers: browserHeaders(ctx), body: { email, otp },
  }), 200, 'Human email verification');
  const login = await ctx.request('/api/auth/sign-in/email', {
    method: 'POST', headers: browserHeaders(ctx), body: { email, password },
  });
  check(login, 200, 'Human password sign-in');
  return identity(ctx, email, login.cookie);
}

export async function claim(ctx, email) {
  const delivered = mailFor(ctx, email).filter(event => /\/api\/auth\/claim\?/.test(event.body.text ?? '')).at(-1);
  assert.ok(delivered, `Expected a claim email addressed to ${email}`);
  const link = delivered.body.text.match(/https?:\/\/[^\s<>"']+\/api\/auth\/claim\?[^\s<>"']+/)?.[0];
  assert.ok(link, 'Claim email must contain its claim URL');
  const url = new URL(link);
  assert.equal(url.origin, new URL(ctx.url).origin, 'Claim link must target the isolated local server');
  const response = await ctx.request(`${url.pathname}${url.search}`);
  assert.ok([302, 303].includes(response.status), `Claim must redirect: ${response.status} ${response.text}`);
  assert.equal(new URL(response.headers.get('location'), ctx.url).pathname, '/app/claimed', 'Claim must reach the agent claim landing');
  return identity(ctx, email, response.cookie);
}

export async function bootstrapWithClaim(ctx, email, extra = {}) {
  await ctx.resetRateLimits();
  const bootstrap = await ctx.bootstrap(email, extra);
  assert.ok(['issued', 'link_sent'].includes(bootstrap.status), `Unexpected bootstrap: ${JSON.stringify(bootstrap)}`);
  const owner = await claim(ctx, email);
  let connected = bootstrap;
  if (bootstrap.status === 'link_sent') {
    connected = check(await ctx.request('/api/agents/connect', {
      method: 'POST', body: { requestId: bootstrap.requestId, pollingToken: bootstrap.pollingToken },
    }), 200, 'Poll approved machine connection');
  }
  assert.equal(connected.status, 'issued', 'Claim must authorize an agent credential');
  assert.match(connected.credential, /^ha_[A-Za-z0-9_-]{43}$/);
  return { ...owner, credential: connected.credential, agentId: connected.agentId, bootstrap };
}
