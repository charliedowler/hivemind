import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { human } from '../fixtures/humans.mjs';
import { oauthToken } from '../fixtures/oauth.mjs';

export default [{
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
