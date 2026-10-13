import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { synthetic } from '../fixtures/models/data.mjs';

const repo = 'example.com/fixture/cache';
const otherRepo = 'example.com/fixture/compiler';
const email = label => `${label}-${randomUUID()}@example.com`;
const modelMethods = new Set(['classifyPush', 'classifyCapture', 'deriveCaptureDetails', 'embedText', 'judgeMemory', 'suggestTags', 'classifyOutcome']);

async function call(ctx, token, name, args = {}) {
  const result = await ctx.mcp(token, name, args);
  if (['hive_search', 'hive_recent', 'hive_ask'].includes(name) || result.isError) ctx.output(result.text, name);
  assert.equal(result.isError, false, `${name} failed: ${result.text}`);
  return result;
}

async function rejected(ctx, token, args, pattern = /project|repository|permission|selection/i) {
  const start = ctx.events.length;
  const result = await ctx.mcp(token, 'hive_push', args);
  ctx.output(result.text, 'capture-refusal');
  await ctx.artifact('refusal.json', { args, result, events: ctx.events.slice(start) });
  assert.equal(result.isError, true, `Expected capture refusal, received ${result.text}`);
  assert.match(result.text, pattern);
  assert.deepEqual(ctx.events.slice(start).filter(event => event.kind === 'model' && modelMethods.has(event.method)), [], 'Refused capture reached extraction, classification or embedding');
}

async function owner(ctx, selected = true) {
  const bootstrap = await ctx.bootstrap(email('capture'));
  assert.match(bootstrap.credential ?? '', /^ha_/, 'Bootstrap must issue a real local agent credential');
  const rows = await ctx.sql`SELECT c.owner_member_id, t.id AS team_id FROM agent_credentials c JOIN teams t ON t.personal_owner_member_id = c.owner_member_id WHERE c.agent_member_id = ${bootstrap.agentId}`;
  assert.equal(rows.length, 1);
  const actor = { ...bootstrap, token: bootstrap.credential, memberId: rows[0].owner_member_id, teamId: rows[0].team_id };
  if (selected) await select(ctx, actor.token, [repo, otherRepo]);
  return actor;
}

async function select(ctx, token, include, revision = 0, exclude = []) {
  return (await call(ctx, token, 'hive_share_projects', { include, exclude, revision, humanInstruction: 'Capture these invented example.com projects privately.' })).value;
}

async function push(ctx, token, extra = {}) {
  const result = await call(ctx, token, 'hive_push', { observation: synthetic.observation, context: { repo, agent: 'codex' }, ...extra });
  assert.equal(result.value?.dropped, undefined, `Fixture unexpectedly excluded: ${result.text}`);
  assert.match(result.value?.id ?? '', /^lrn_/);
  return result.value;
}

async function search(ctx, token, id, present, extra = {}) {
  const result = await call(ctx, token, 'hive_search', { query: 'synthetic build cache lockfile', limit: 25, ...extra });
  assert.equal(result.text.includes(id), present, `Expected ${id} ${present ? 'in' : 'absent from'} search: ${result.text}`);
  return result;
}

async function mutate(ctx, cookie, path, body, status = 200) {
  const response = await ctx.request(path, { method: 'POST', cookie, headers: { origin: ctx.url }, body });
  assert.equal(response.status, status, `${path}: ${response.text}`);
  return response;
}

async function key(ctx, person, teamId) {
  const switched = await mutate(ctx, person.cookie, '/api/app/switch-hive', { teamId });
  if (switched.cookie) person.cookie = switched.cookie;
  const result = await mutate(ctx, person.cookie, '/api/app/keys', { label: 'Synthetic capture test' }, 201);
  assert.match(result.body.apiKey, /^hm_/);
  return result.body.apiKey;
}

async function organisation(ctx) {
  const { bootstrapWithClaim, human } = await import('../fixtures/humans.mjs');
  const domain = `${randomUUID()}.example.com`;
  const person = await bootstrapWithClaim(ctx, `owner@${domain}`);
  assert.match(person.credential ?? '', /^ha_/);
  await select(ctx, person.credential, [repo, otherRepo]);
  const colleague = await human(ctx, { email: `colleague@${domain}`, name: 'Example Colleague' });
  const created = await mutate(ctx, colleague.cookie, '/api/app/create-organisation', { requestKey: randomUUID() });
  if (created.cookie) colleague.cookie = created.cookie;
  const teamId = created.body.teamId;
  assert.ok(teamId, 'Organisation HTTP response must include teamId');
  await ctx.sql`INSERT INTO hive_memberships (member_id, team_id) VALUES (${person.memberId}, ${teamId}) ON CONFLICT (member_id,team_id) DO UPDATE SET removed_at = NULL`;
  await ctx.sql`INSERT INTO hive_memberships (member_id, team_id, owner_member_id) VALUES (${person.agentId}, ${teamId}, ${person.memberId}) ON CONFLICT (member_id,team_id) DO UPDATE SET removed_at = NULL`;
  const audienceToken = await key(ctx, colleague, teamId);
  const personalToken = await key(ctx, person, person.teamId);
  return { person, colleague, teamId, token: person.credential, audienceToken, personalToken };
}

async function publish(ctx, setup, mode = 'all_selected') {
  return (await call(ctx, setup.token, 'hive_share_with', {
    teamId: setup.teamId, mode, projects: mode === 'projects' ? [repo] : [],
    humanInstruction: mode === 'not_now' ? 'Keep my projects private for now.' : 'Share the selected synthetic projects with this organisation, including future captures.',
  })).value;
}

async function archive(ctx, token) {
  const snapshot = (await call(ctx, token, 'hive_snapshot')).value;
  assert.ok(Number.isFinite(Date.parse(snapshot.expiresAt)));
  const target = new URL(snapshot.url);
  assert.equal(target.origin, new URL(ctx.url).origin, 'Archive download must remain on the local test server');
  const response = await fetch(target);
  const bytes = Buffer.from(await response.arrayBuffer());
  await ctx.artifact(`archive-${randomUUID()}.json`, { url: target.href, status: response.status, headers: Object.fromEntries(response.headers), bytes: bytes.length });
  assert.equal(response.status, 200, 'Snapshot URL must download');
  assert.match(response.headers.get('content-type') ?? '', /gzip/);
  return { snapshot, text: gunzipSync(bytes).toString('utf8') };
}

async function findFile(ctx, token, id, path = '') {
  const listing = (await call(ctx, token, 'hive_browse', { path })).value;
  assert.ok(Array.isArray(listing.entries));
  for (const entry of listing.entries) {
    if (entry.type === 'file' && entry.path.includes(id)) return entry.path;
    if (entry.type === 'directory') {
      const found = await findFile(ctx, token, id, entry.path);
      if (found) return found;
    }
  }
  return null;
}

const scenarios = [
  {
    name: 'capture-selected-project-personal-only', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const start = ctx.events.length;
      const cell = await push(ctx, actor.token);
      const methods = new Set(ctx.events.slice(start).filter(event => event.kind === 'model').map(event => event.method));
      for (const method of ['classifyCaptureCategories', 'classifyPush', 'deriveCaptureDetails', 'embedText']) assert.ok(methods.has(method), `Safe capture must exercise ${method}`);
      assert.equal(cell.learning.repo, repo);
      assert.equal(cell.learning.source, 'codex');
      const rows = await ctx.sql`SELECT team_id, owner_member_id FROM learnings WHERE id = ${cell.id}`;
      assert.deepEqual(rows.map(row => [row.team_id, row.owner_member_id]), [[actor.teamId, actor.memberId]]);
      assert.equal((await ctx.sql`SELECT * FROM learning_shares WHERE learning_id = ${cell.id}`).length, 0);
      await search(ctx, actor.token, cell.id, true);
      const outsider = await owner(ctx);
      await search(ctx, outsider.token, cell.id, false, { include_history: true });
      const path = await findFile(ctx, actor.token, cell.id);
      assert.ok(path, 'Personal capture must be browsable');
      const file = await call(ctx, actor.token, 'hive_read', { path });
      assert.ok(file.text.includes(synthetic.observation));
      assert.equal((await ctx.mcp(outsider.token, 'hive_read', { path })).isError, true);
    },
  },
  ...[
    ['no-selection', false, { context: { repo } }],
    ['unselected-project', true, { context: { repo: 'example.com/fixture/private' } }],
    ['missing-project', true, { context: { agent: 'codex' } }],
    ['chat-without-project', true, { context: { agent: 'codex', sessionType: 'chat' } }],
    ['contradictory-remote', true, { repo, remote: 'https://example.com/fixture/private.git' }],
    ['contradictory-nested-context', true, { repo, context: { repo: otherRepo } }],
  ].map(([name, selected, extra]) => ({
    name: `capture-refuses-${name}`, fast: true,
    async run(ctx) {
      const actor = await owner(ctx, selected);
      await rejected(ctx, actor.token, { observation: synthetic.observation, ...extra });
      assert.equal((await ctx.sql`SELECT id FROM learnings WHERE owner_member_id = ${actor.memberId}`).length, 0);
    },
  })),
  {
    name: 'capture-excluded-pattern-wins', fast: true,
    async run(ctx) {
      const actor = await owner(ctx, false);
      await select(ctx, actor.token, ['example.com/fixture/*'], 0, [otherRepo]);
      await push(ctx, actor.token);
      await rejected(ctx, actor.token, { observation: synthetic.observation, repo: otherRepo });
    },
  },
  {
    name: 'capture-agent-cannot-expand-selection', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const narrowed = await select(ctx, actor.token, [repo], 1);
      assert.equal(narrowed.revision, 2);
      const expanded = await ctx.mcp(actor.token, 'hive_share_projects', { include: [repo, otherRepo], exclude: [], revision: 2, humanInstruction: 'Add another project without a new human grant.' });
      assert.equal(expanded.isError, true);
      assert.match(expanded.text, /human|delegation/i);
      await rejected(ctx, actor.token, { observation: synthetic.observation, repo: otherRepo });
    },
  },
  ...['credentials', 'personal', 'customer'].flatMap(kind => ['observation', 'evidence'].map(location => ({
    name: `capture-privacy-${kind}-${location}`, fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const start = ctx.events.length;
      const result = await ctx.mcp(actor.token, 'hive_push', {
        observation: location === 'observation' ? synthetic[kind] : synthetic.observation,
        ...(location === 'evidence' ? { evidence: { command_output: synthetic[kind] } } : {}),
        context: { repo, agent: 'codex' },
      });
      const events = ctx.events.slice(start);
      await ctx.artifact('privacy.json', { kind, location, result, events });
      assert.ok(result.isError || result.value?.dropped === true, `Sensitive ${kind} ${location} was saved: ${result.text}`);
      if (result.isError) assert.match(result.text, /secret|personal|sensitive|credential|customer|excluded/i);
      else assert.equal(result.value.rule, 'content_category');
      assert.deepEqual(events.filter(event => event.kind === 'model'), [], 'Local privacy refusal must not reach any provider');
      assert.deepEqual(events.filter(event => event.kind === 'model' && modelMethods.has(event.method)), [], 'Rejected content reached extraction, classifier or embedding');
      assert.equal((await ctx.sql`SELECT id FROM learnings WHERE owner_member_id = ${actor.memberId}`).length, 0);
    },
  }))),
  {
    name: 'capture-observation-evidence-inference', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const cell = await push(ctx, actor.token, { evidence: { command_output: synthetic.measured }, context: { remote: 'https://example.com/fixture/cache.git', agent: 'codex', paths: ['schema.ts'], branch: 'fixture/cache' } });
      assert.equal(cell.learning.title, synthetic.title);
      assert.equal(cell.learning.body, synthetic.observation);
      assert.equal(cell.learning.kind, 'friction');
      assert.equal(cell.learning.area, 'tool');
      assert.equal(cell.learning.blocked, true);
      assert.equal(cell.learning.cost, 12);
      assert.equal(cell.learning.workaround, 'Regenerating the client');
      assert.deepEqual(cell.learning.paths, ['schema.ts']);
      assert.deepEqual(cell.correction, { tool: 'hive_correct', id: cell.id, revision: cell.learning.revision });
      assert.equal(cell.inferred.repo, repo);
    },
  },
  {
    name: 'capture-explicit-overrides-preserved', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const cell = await push(ctx, actor.token, {
        title: 'Explicit synthetic build cache title', body: 'Explicit synthetic build cache observation.',
        kind: 'friction', tags: ['explicit-fixture'], area: 'environment', blocked: false,
        cost: 7, workaround: 'Explicit fixture workaround', confidence: 0.95,
        source: 'manual', paths: ['explicit.ts'], evidence: synthetic.measured,
      });
      for (const [field, expected] of Object.entries({ title: 'Explicit synthetic build cache title', body: 'Explicit synthetic build cache observation.', kind: 'friction', area: 'environment', blocked: false, cost: 7, workaround: 'Explicit fixture workaround', source: 'manual' })) assert.equal(cell.learning[field], expected, `Caller override ${field} must win`);
      assert.deepEqual(cell.learning.tags, ['explicit-fixture']);
      assert.deepEqual(cell.learning.paths, ['explicit.ts']);
      assert.ok(Math.abs(cell.learning.confidence - 0.95) < 0.00001);
    },
  },
  {
    name: 'capture-unmeasured-cost-stays-unknown', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const cell = await push(ctx, actor.token, { evidence: synthetic.estimated });
      assert.equal(cell.learning.cost, null);
      assert.equal(cell.learning.blocked, null);
      assert.equal(cell.learning.workaround, null);
    },
  },
  {
    name: 'capture-concurrent-retries-idempotent', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const results = await Promise.all(Array.from({ length: 3 }, () => push(ctx, actor.token, { context: { repo, agent: 'codex', sessionRef: 'synthetic-retry' } })));
      assert.equal(new Set(results.map(result => result.id)).size, 1);
      const rows = await ctx.sql`SELECT push_count FROM learnings WHERE id = ${results[0].id}`;
      assert.equal(rows[0].push_count, 1);
      assert.equal((await ctx.sql`SELECT id FROM learning_pushes WHERE learning_id = ${results[0].id}`).length, 1);
    },
  },
  {
    name: 'capture-correction-revision-history', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const cell = await push(ctx, actor.token);
      const stranger = await owner(ctx);
      const handle = { id: cell.id, revision: cell.learning.revision, observation: 'The synthetic build cache also needs the compiler version in its key.', evidence: 'The fixture build passes only with both key fields.' };
      const denied = await ctx.mcp(stranger.token, 'hive_correct', handle);
      assert.equal(denied.isError, true);
      const corrected = (await call(ctx, actor.token, 'hive_correct', handle)).value;
      assert.ok(corrected.revision > handle.revision);
      const stale = await ctx.mcp(actor.token, 'hive_correct', handle);
      assert.equal(stale.isError, true);
      assert.match(stale.text, /changed|revision|again/i);
      const versions = await ctx.sql`SELECT content FROM learning_versions WHERE learning_id = ${cell.id} ORDER BY revision DESC`;
      assert.ok(versions.some(row => row.content.body === handle.observation));
      assert.ok(versions.some(row => row.content.body === synthetic.observation));
      await call(ctx, actor.token, 'hive_correct', { id: cell.id, revision: corrected.revision, retract: true });
      await search(ctx, actor.token, cell.id, false);
      await search(ctx, actor.token, cell.id, true, { include_history: true });
    },
  },
  {
    name: 'capture-retrieval-never-votes', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const cell = await push(ctx, actor.token);
      await search(ctx, actor.token, cell.id, true);
      await call(ctx, actor.token, 'hive_recent', { since: '24h' });
      await call(ctx, actor.token, 'hive_ask', { question: 'How does the synthetic build cache use the lockfile?' });
      assert.equal((await ctx.sql`SELECT * FROM feedback WHERE learning_id = ${cell.id}`).length, 0);
      assert.equal((await ctx.sql`SELECT * FROM feedback_receipts WHERE learning_id = ${cell.id}`).length, 0);
    },
  },
  ...[['useful', 'up'], ['contradicted', 'down'], ['stale', 'outdated'], ['inconclusive', null]].map(([kind, vote]) => ({
    name: `capture-outcome-${kind}`, fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const cell = await push(ctx, actor.token);
      const result = (await call(ctx, actor.token, 'hive_outcome', { id: cell.id, outcome: synthetic[kind], ...(kind === 'inconclusive' ? {} : { evidence: synthetic[kind] }) })).value;
      assert.equal(result.classification, kind);
      assert.equal(result.vote, vote);
      assert.deepEqual(result.votes, { up: vote === 'up' ? 1 : 0, down: vote === 'down' ? 1 : 0, outdated: vote === 'outdated' ? 1 : 0 });
      await search(ctx, actor.token, cell.id, !['contradicted', 'stale'].includes(kind));
      await search(ctx, actor.token, cell.id, true, { include_history: true });
    },
  })),
  {
    name: 'capture-feedback-one-vote-and-receipt-undo', fast: true,
    async run(ctx) {
      const actor = await owner(ctx);
      const cell = await push(ctx, actor.token);
      const first = (await call(ctx, actor.token, 'hive_feedback', { id: cell.id, vote: 'up' })).value;
      const second = (await call(ctx, actor.token, 'hive_feedback', { id: cell.id, vote: 'down' })).value;
      assert.deepEqual(second.votes, { up: 0, down: 1, outdated: 0 });
      const stale = await ctx.mcp(actor.token, 'hive_feedback', { id: cell.id, withdraw: true, receipt: first.receipt });
      assert.equal(stale.isError, true);
      const restored = (await call(ctx, actor.token, 'hive_feedback', { id: cell.id, withdraw: true, receipt: second.receipt })).value;
      assert.deepEqual(restored.votes, { up: 1, down: 0, outdated: 0 });
      const withdrawn = (await call(ctx, actor.token, 'hive_feedback', { id: cell.id, withdraw: true, receipt: first.receipt })).value;
      assert.deepEqual(withdrawn.votes, { up: 0, down: 0, outdated: 0 });
    },
  },
  ...['all_selected', 'projects', 'not_now'].map(mode => ({
    name: `capture-publication-${mode.replaceAll('_', '-')}`, fast: true,
    async run(ctx) {
      const setup = await organisation(ctx);
      const first = await push(ctx, setup.token);
      const second = await push(ctx, setup.token, { observation: 'The synthetic build cache compiler uses a separate compiler fingerprint.', context: { repo: otherRepo } });
      await search(ctx, setup.audienceToken, first.id, false, { include_history: true });
      const before = await archive(ctx, setup.audienceToken);
      assert.ok(!before.text.includes(first.id));
      const result = await publish(ctx, setup, mode);
      assert.equal(result.mode, mode);
      await search(ctx, setup.audienceToken, first.id, mode !== 'not_now');
      await search(ctx, setup.audienceToken, second.id, mode === 'all_selected');
      const later = await push(ctx, setup.token, { observation: 'The synthetic build cache future capture checks dependency fingerprints.' });
      await search(ctx, setup.audienceToken, later.id, mode !== 'not_now');
      const snapshot = await archive(ctx, setup.audienceToken);
      assert.equal(snapshot.text.includes(first.id), mode !== 'not_now');
      assert.equal(snapshot.text.includes(second.id), mode === 'all_selected');
      assert.equal(snapshot.text.includes(later.id), mode !== 'not_now');
      const originals = await ctx.sql`SELECT id, team_id FROM learnings WHERE id IN (${first.id}, ${second.id}, ${later.id})`;
      assert.equal(originals.length, 3);
      assert.ok(originals.every(row => row.team_id === setup.person.teamId));
      const grants = await ctx.sql`SELECT grant_kind, repo_pattern FROM project_sharing_grants WHERE owner_member_id = ${setup.person.memberId} AND team_id = ${setup.teamId} AND withdrawn_at IS NULL`;
      assert.equal(grants.length, mode === 'not_now' ? 0 : 1);
      if (mode === 'all_selected') assert.equal(grants[0].grant_kind, 'all_selected');
      if (mode === 'projects') assert.equal(grants[0].repo_pattern, repo);
      const newRepo = 'example.com/fixture/new-project';
      await mutate(ctx, setup.person.cookie, '/api/app/capture-rules/projects', { include: [repo, otherRepo, newRepo], exclude: [], revision: 1 });
      const newProject = await push(ctx, setup.token, { observation: 'The synthetic build cache new project checks dependency versions.', context: { repo: newRepo } });
      await search(ctx, setup.audienceToken, newProject.id, mode === 'all_selected');
    },
  })),
  {
    name: 'capture-publication-withdrawal-revokes-snapshot', fast: true,
    async run(ctx) {
      const setup = await organisation(ctx);
      const cell = await push(ctx, setup.token);
      await publish(ctx, setup);
      await search(ctx, setup.audienceToken, cell.id, true);
      const issued = await archive(ctx, setup.audienceToken);
      assert.ok(issued.text.includes(cell.id));
      const path = await findFile(ctx, setup.audienceToken, cell.id);
      assert.ok(path);
      assert.ok((await call(ctx, setup.audienceToken, 'hive_read', { path })).text.includes(synthetic.observation));
      const grants = await ctx.sql`SELECT id FROM project_sharing_grants WHERE owner_member_id = ${setup.person.memberId} AND team_id = ${setup.teamId} AND withdrawn_at IS NULL`;
      assert.equal(grants.length, 1);
      await mutate(ctx, setup.person.cookie, '/api/app/project-sharing', { action: 'withdraw', teamId: setup.teamId, grantId: grants[0].id });
      await search(ctx, setup.audienceToken, cell.id, false, { include_history: true });
      assert.equal((await ctx.mcp(setup.audienceToken, 'hive_read', { path })).isError, true);
      const old = await ctx.request(new URL(issued.snapshot.url).pathname + new URL(issued.snapshot.url).search);
      assert.equal(old.status, 404, `Previously issued archive must be revoked after withdrawal: ${old.status}`);
      const fresh = await archive(ctx, setup.audienceToken);
      assert.ok(!fresh.text.includes(cell.id));
      await search(ctx, setup.token, cell.id, true);
      const later = await push(ctx, setup.token, { observation: 'The synthetic build cache remains personal after project withdrawal.' });
      await search(ctx, setup.audienceToken, later.id, false);
    },
  },
  {
    name: 'capture-two-downvotes-hidden-unless-history', fast: true,
    async run(ctx) {
      const setup = await organisation(ctx);
      const cell = await push(ctx, setup.token);
      await publish(ctx, setup);
      const ownerOrgToken = await key(ctx, setup.person, setup.teamId);
      await call(ctx, setup.audienceToken, 'hive_feedback', { id: cell.id, vote: 'down' });
      const second = (await call(ctx, ownerOrgToken, 'hive_feedback', { id: cell.id, vote: 'down' })).value;
      assert.equal(second.votes.down, 2);
      await search(ctx, setup.audienceToken, cell.id, false);
      await search(ctx, setup.audienceToken, cell.id, true, { include_history: true });
      const recent = await call(ctx, setup.audienceToken, 'hive_recent', { since: '24h' });
      assert.ok(!recent.text.includes(cell.id));
      const historical = await call(ctx, setup.audienceToken, 'hive_recent', { since: '24h', include_history: true });
      assert.ok(historical.text.includes(cell.id));
    },
  },
];

scenarios.push({
  name: 'capture-recognized-credential-redacted-before-provider', fast: true,
  async run(ctx) {
    const actor = await owner(ctx);
    const fixtureCredential = `sk-ant-${'example'.repeat(5)}`;
    const start = ctx.events.length;
    const result = await ctx.mcp(actor.token, 'hive_push', { observation: `The synthetic fixture contains ${fixtureCredential}`, context: { repo, agent: 'codex' } });
    assert.ok(result.isError || result.value?.dropped);
    const calls = ctx.events.slice(start).filter(event => event.kind === 'model');
    assert.deepEqual(calls, [], 'Secret-only captures must stop before the category provider');
    assert.equal(JSON.stringify(calls).includes(fixtureCredential), false, 'Recognized credentials must never reach a provider');
    assert.equal((await ctx.sql`SELECT id FROM learnings WHERE owner_member_id = ${actor.memberId}`).length, 0);
    await ctx.artifact('redaction.json', { calls, result });
  },
});

for (const kind of ['credentials', 'personal', 'customer']) scenarios.push({
  name: `capture-privacy-${kind}-blocked-before-model`, fast: true,
  async run(ctx) {
    const actor = await owner(ctx);
    await ctx.sql`UPDATE capture_rules SET enabled = false WHERE team_id = ${actor.teamId}`;
    const start = ctx.events.length;
    const result = await ctx.mcp(actor.token, 'hive_push', { observation: synthetic[kind], context: { repo, agent: 'codex' } });
    assert.ok(result.isError || result.value?.dropped, 'Sensitive content must be refused');
    const calls = ctx.events.slice(start).filter(event => event.kind === 'model');
    await ctx.artifact('pre-model-privacy.json', { result, calls });
    assert.deepEqual(calls, [], 'The requested privacy contract blocks sensitive content before any model call');
    assert.equal((await ctx.sql`SELECT id FROM learnings WHERE owner_member_id = ${actor.memberId}`).length, 0);
    const refusal = await ctx.sql`SELECT reason_code, properties FROM analytics_events WHERE team_id = ${actor.teamId} AND event_name = 'capture.rule_dropped' ORDER BY occurred_at DESC LIMIT 1`;
    await ctx.artifact('privacy-refusal.json', refusal);
    assert.equal(refusal[0]?.reason_code, 'sensitive_refused');
    assert.ok(refusal[0]?.properties.privacyReason);
    assert.equal(JSON.stringify(refusal).includes(synthetic[kind]), false, 'Refusal telemetry must not echo the observation');
  },
});

scenarios.push({
  name: 'capture-useful-credential-fact-redacted-before-provider', fast: true,
  async run(ctx) {
    const actor = await owner(ctx);
    const start = ctx.events.length;
    const password = 'example-only-parser-password';
    const result = await ctx.mcp(actor.token, 'hive_push', {observation: `The parser test uses password: "${password}" in tests/auth.test.ts.`, context: {repo, agent: 'codex'}});
    assert.equal(result.isError, false, result.text);
    assert.ok(result.value?.id, 'Useful sanitized facts must remain capturable');
    const calls = ctx.events.slice(start).filter(event => event.kind === 'model');
    assert.ok(calls.some(event => event.method === 'classifyCaptureCategories'), 'Exercise the real category provider boundary with a safe fact');
    assert.ok(calls.some(event => event.method === 'classifyPush'), 'Exercise downstream inference with a safe fact');
    assert.equal(JSON.stringify(calls).includes(password), false, 'A redacted credential must not reach any provider');
    const rows = await ctx.sql`SELECT body FROM learnings WHERE id = ${result.value.id}`;
    assert.ok(rows[0].body.includes('[redacted]'));
    assert.equal(rows[0].body.includes(password), false);
    await ctx.artifact('redaction.json', {result, calls, rows});
  },
});

scenarios.push({
  name: 'capture-hook-context-redacted-before-provider', fast: true,
  async run(ctx) {
    const actor = await owner(ctx);
    const password = 'example-only-hook-password';
    const start = ctx.events.length;
    const result = await ctx.request('/api/app/capture', {token: actor.token, body: {text: synthetic.observation, changes: 1, errors: 1, observations: 1, repo, agent: 'codex', branch: `The config parser uses PASSWORD=${password}`}});
    assert.equal(result.status, 200, result.text);
    const calls = ctx.events.slice(start).filter(event => event.kind === 'model');
    assert.ok(calls.some(event => event.method === 'classifyCapture'), 'Exercise the hook summary provider boundary');
    assert.equal(JSON.stringify(calls).includes(password), false, 'Context credentials must not reach providers');
    await ctx.artifact('redaction.json', {result, calls});
  },
});

export default scenarios;
