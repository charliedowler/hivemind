import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { human } from '../fixtures/humans.mjs';
import { oauthToken } from '../fixtures/oauth.mjs';

export default [{
  name: 'onboarding-retired-agentid-routes', fast: true,
  async run(ctx) {
    const start = ctx.events.length;
    const results = [];
    for (const path of ['/api/auth/agentid', '/api/auth/agentid/start', '/api/auth/agentid/anything', '/api/auth/callback/agentid', '/api/auth/callback/agentid/anything']) {
      for (const method of ['GET', 'POST']) {
        const response = await ctx.request(path, { method });
        results.push({ path, method, status: response.status, body: response.body });
        assert.equal(response.status, 404, `Retired ${method} ${path} must return 404`);
        assert.equal(response.headers.get('location'), null);
        assert.equal(response.headers.getSetCookie().length, 0);
      }
    }
    assert.equal(ctx.events.slice(start).filter(event => ['mail', 'slack', 'model'].includes(event.kind)).length, 0);
    await ctx.artifact('retired-route-responses.json', results);
  },
}, {
  name: 'onboarding-human-oauth-person-wide-two-organisations', fast: true,
  async run(ctx) {
    const owner = await human(ctx, { email: `oauth-${randomUUID()}@example.com`, name: 'Robin Example' });
    const scoped = await oauthToken(ctx, owner);
    const wide = await oauthToken(ctx, owner, { personWide: true });
    const before = await ctx.mcp(wide.access_token, 'hive_invite_link');
    assert.equal(before.isError, false, before.text);
    assert.deepEqual(before.value.invitations, []);
    const teams = [];
    for (let i = 0; i < 2; i++) {
      const admin = await human(ctx, { email: `admin-${randomUUID()}@example.com`, name: 'Taylor Example' });
      const created = await ctx.request('/api/app/create-organisation', { cookie: admin.cookie, body: { requestKey: randomUUID() } });
      assert.equal(created.status, 200, created.text);
      teams.push(created.body.teamId);
      await ctx.sql`INSERT INTO hive_memberships (member_id, team_id) VALUES (${owner.memberId}, ${created.body.teamId})`;
    }
    const result = await ctx.mcp(wide.access_token, 'hive_invite_link');
    assert.equal(result.isError, false, result.text);
    assert.deepEqual(result.value.invitations.map(item => item.teamId).sort(), teams.sort());
    const narrow = await ctx.mcp(scoped.access_token, 'hive_invite_link');
    assert.equal(narrow.isError, false, narrow.text);
    assert.equal(narrow.value.joinUrl, null);
    assert.equal(narrow.value.invitations, undefined, 'A scoped OAuth token must not acquire future organisations');
    await ctx.artifact('token-scope-claims.json', { scoped: scoped.claims, personWide: wide.claims });
  },
}];
