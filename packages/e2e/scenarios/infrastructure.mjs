import assert from 'node:assert/strict';

export default [{
  name: 'infrastructure-isolation', fast: true,
  async run(ctx) {
    const health = await ctx.request('/api/health');
    assert.equal(health.body.commit, ctx.commit);
    assert.match(ctx.db.name, /^hive_capture_rules_hive_digest_e2e_[a-f0-9]+$/);
    const boot = await ctx.bootstrap('infrastructure@example.com');
    assert.equal(boot.status, 'issued');
    const messages = ctx.events.filter(event => event.kind === 'mail');
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].body.to, ['infrastructure@example.com']);
    const policy = await ctx.mcp(boot.credential, 'hive_share_projects', { revision: 0 });
    assert.equal(policy.isError, false, policy.text);
    assert.deepEqual(policy.value, { mode: 'everything', include: [], exclude: [], workAreas: '', revision: 0 });
    assert.equal(Number((await ctx.sql`SELECT count(*) AS count FROM learnings`)[0].count), 0);
    await assert.rejects(ctx.request('https://gohive.dev/api/health'), /nonlocal request/);
    const rejected = await ctx.mcp('ha_' + 'x'.repeat(43), 'hive_share_projects', { revision: 0 });
    assert.equal(rejected.isError, true);
  },
}];
