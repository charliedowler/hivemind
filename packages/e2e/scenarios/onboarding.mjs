import assert from 'node:assert/strict';
import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { human, claim, bootstrapWithClaim, mailFor } from '../fixtures/humans.mjs';

const domain = () => `onboarding-${randomUUID().slice(0, 12)}.example.test`;
const email = (label = 'person') => `${label}-${randomUUID()}@example.com`;
const headers = ctx => ({ origin: new URL(ctx.url).origin, 'content-type': 'application/json' });

function expectStatus(response, expected, step) {
  assert.equal(response.status, expected, `${step}: expected ${expected}, received ${response.status}: ${response.text}`);
  return response.body;
}

async function post(ctx, path, cookie, body, status = 200) {
  return expectStatus(await ctx.request(path, { method: 'POST', cookie, headers: headers(ctx), body }), status, path);
}

async function mcp(ctx, token, name, args = {}) {
  const result = await ctx.mcp(token, name, args);
  assert.equal(Boolean(result.isError), false, `${name}: ${result.text}`);
  return result.value;
}

async function create(ctx, owner, requestKey = randomUUID()) {
  return post(ctx, '/api/app/create-organisation', owner.cookie, { requestKey });
}

async function organisation(ctx, workDomain = domain()) {
  const owner = await human(ctx, { email: `admin@${workDomain}`, name: 'Example Admin' });
  const team = await create(ctx, owner);
  assert.equal(team.joinPaused, false, 'A fresh eligible work domain must enable joining');
  return { ...team, owner, domain: workDomain, phrase: new URL(team.joinUrl).pathname.split('/').at(-1) };
}

async function membership(ctx, memberId, teamId, expected = true) {
  const rows = await ctx.sql`SELECT role, owner_member_id FROM hive_memberships WHERE member_id = ${memberId} AND team_id = ${teamId} AND removed_at IS NULL`;
  assert.equal(rows.length, expected ? 1 : 0, `${memberId} active membership in ${teamId}`);
  return rows[0];
}

async function agentStatus(ctx, token) {
  return expectStatus(await ctx.request('/api/agents/status', { token }), 200, 'Agent status');
}

async function selectProjects(ctx, owner, include, revision = 0) {
  return post(ctx, '/api/app/capture-rules/projects', owner.cookie, { mode: 'selected', include, exclude: [], revision, humanInstruction: 'Capture the selected example projects privately.' });
}

async function capture(ctx, token, repo, label) {
  const eventStart = ctx.events.length;
  const result = await mcp(ctx, token, 'hive_push', {
    title: `${label} ${randomUUID().slice(0, 8)}`,
    body: `The ${label} fixture verified that a bounded retry with a stable request identifier prevents duplicate writes. Keep the identifier across retries.`,
    kind: 'learning', repo, source: 'codex', confidence: 0.95, tags: ['e2e'], paths: ['src/example.mjs'],
  });
  assert.ok(result?.id, `Capture must create a cell: ${JSON.stringify(result)}`);
  assert.notEqual(result.dropped, true, 'The synthetic learning must not be dropped');
  const calls = ctx.events.slice(eventStart).filter(event => event.kind === 'model').map(event => event.method);
  assert.ok(calls.includes('classifyPush'), 'The positive capture must reach the installed model fixture');
  assert.ok(calls.includes('embedText'), 'The positive capture must reach the embedding fixture');
  return result.id;
}

async function shares(ctx, ownerId, teamId) {
  return ctx.sql`SELECT learning_id FROM learning_shares WHERE owner_member_id = ${ownerId} AND team_id = ${teamId} AND withdrawn_at IS NULL ORDER BY learning_id`;
}

async function assertShares(ctx, ownerId, teamId, ids) {
  assert.deepEqual((await shares(ctx, ownerId, teamId)).map(row => row.learning_id).sort(), [...ids].sort(), 'Only the explicitly selected audience may read published cells');
}

async function requestJoin(ctx, team, person) {
  const response = await post(ctx, '/api/app/join-phrase', person.cookie, { phrase: team.phrase });
  assert.deepEqual(response, { status: 'requested' });
  const rows = await ctx.sql`SELECT * FROM hive_join_requests WHERE team_id = ${team.teamId} AND member_id = ${person.memberId} AND status = 'pending'`;
  assert.equal(rows.length, 1, 'Exactly one pending request must be stored');
  return rows[0];
}

async function approve(ctx, team, request) {
  return post(ctx, '/api/app/join-requests', team.owner.cookie, { id: request.id, decision: 'approve' });
}

async function installSlackFixture(ctx, team) {
  const workspace = `T_E2E_${randomUUID().replaceAll('-', '')}`;
  const user = `U_E2E_${Buffer.from(`admin@${team.domain}`).toString('base64url')}`;
  const key = Buffer.from(ctx.env?.SLACK_TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 23).toString('base64'), 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${team.teamId}:${workspace}`));
  const encrypted = Buffer.concat([cipher.update('xoxb-example-fixture', 'utf8'), cipher.final()]);
  const ciphertext = ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
  await ctx.sql`INSERT INTO slack_installations (team_id, workspace_id, workspace_name, bot_user_id, token_ciphertext, installed_by, scopes) VALUES (${team.teamId}, ${workspace}, 'Example Workspace', 'U_E2E_BOT', ${ciphertext}, ${team.owner.memberId}, ${['chat:write', 'users:read', 'users:read.email']})`;
  await ctx.sql`INSERT INTO slack_actor_links (team_id, slack_user_id, member_id) VALUES (${team.teamId}, ${user}, ${team.owner.memberId})`;
  await ctx.artifact('slack-fixture.json', { workspace, user, seeded: ['slack_installations', 'slack_actor_links'], identitySeeded: false });
  return { workspace, user };
}

async function slackMessage(ctx, slack, notification, text) {
  const start = ctx.events.length;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = { type: 'event_callback', team_id: slack.workspace, event_id: `Ev_${randomUUID()}`, event: {
    type: 'message', channel_type: 'im', channel: notification.channel_id, thread_ts: notification.thread_ts,
    ts: `${timestamp}.${randomBytes(3).readUIntBE(0, 3).toString().slice(0, 6).padStart(6, '0')}`, user: slack.user, text,
  } };
  const signature = createHmac('sha256', ctx.env?.SLACK_SIGNING_SECRET || 'hive-e2e-slack-signing').update(`v0:${timestamp}:${JSON.stringify(body)}`).digest('hex');
  expectStatus(await ctx.request('/api/slack/events', { method: 'POST', body, headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${signature}` } }), 200, `Slack ${text}`);
  return start;
}

// What the routing model double saw for the message sent at `start`, and the tool it chose.
async function routed(ctx, start, method = 'slackRoute') {
  for (let attempt = 0; attempt < 80; attempt++) {
    const event = ctx.events.slice(start).find(item => item.kind === 'model' && item.method === method);
    if (event) return event;
    await delay(250);
  }
  assert.fail(`Slack message never reached ${method}`);
}

function assertNoticeFor(route, request, address) {
  assert.deepEqual(route.input.threadContext.notices.map(notice => ({ kind: notice.kind, requestId: notice.requestId, email: notice.person.email, status: notice.status, noticeIsThisThread: notice.noticeIsThisThread })), [
    { kind: 'join_request', requestId: request.id, email: address, status: 'pending', noticeIsThisThread: true },
  ], 'The routing model must see the pending join request this thread answers');
}

async function slackDecision(ctx, text) {
  const team = await organisation(ctx);
  const slack = await installSlackFixture(ctx, team);
  const address = email('slack');
  const person = await bootstrapWithClaim(ctx, address);
  const request = await requestJoin(ctx, team, person);
  const [notification] = await ctx.sql`SELECT * FROM hive_join_request_notifications WHERE request_id = ${request.id} AND admin_member_id = ${team.owner.memberId}`;
  assert.equal(notification.status, 'sent', 'The admin must receive the request DM');
  const start = await slackMessage(ctx, slack, notification, text(address));
  const route = await routed(ctx, start);
  await waitRequest(ctx, request.id, 'approved');
  await membership(ctx, person.memberId, team.teamId);
  await membership(ctx, person.agentId, team.teamId);
  assertNoticeFor(route, request, address);
  assert.equal(route.tool, 'hive_decide_join_request');
  const jev = await routed(ctx, start, 'decideDecisiveness');
  assert.equal(jev.input.action, 'join_request');
  assert.equal(jev.input.context.notices[0].requestId, request.id, 'Jev must judge the reply with the notice it answers');
  return { request, address, route, jev };
}

async function waitRequest(ctx, requestId, status) {
  let row;
  for (let attempt = 0; attempt < 80; attempt++) {
    [row] = await ctx.sql`SELECT * FROM hive_join_requests WHERE id = ${requestId}`;
    if (row?.status === status) return row;
    await delay(250);
  }
  await ctx.artifact('slack-jobs.json', await ctx.sql`SELECT id, kind, status, error FROM slack_jobs WHERE team_id = ${row.team_id}`);
  assert.equal(row?.status, status, `Slack queue must complete the real join decision; current status ${row?.status}`);
}

const scenarios = [
  {
    name: 'onboarding-fresh-bootstrap-claim-domain-follow', fast: true,
    async run(ctx) {
      const team = await organisation(ctx);
      const address = `person@${team.domain}`;
      await ctx.resetRateLimits();
      const boot = await ctx.bootstrap(address, { agentName: 'Example Agent', machine: 'Example Laptop' });
      assert.equal(boot.status, 'issued');
      assert.match(boot.credential, /^ha_[A-Za-z0-9_-]{43}$/);
      const [owner] = await ctx.sql`SELECT * FROM members WHERE email = ${address}`;
      assert.equal(owner.provisional, true);
      assert.equal(owner.email_verified, false);
      await membership(ctx, owner.id, team.teamId, false);
      await membership(ctx, boot.agentId, team.teamId, false);
      const before = await agentStatus(ctx, boot.credential);
      assert.equal(before.claimPending, true);
      assert.deepEqual(before.organisations, []);
      assert.equal((await mcp(ctx, boot.credential, 'hive_agent_status')).claimPending, true);
      assert.equal(mailFor(ctx, address).length, 1, 'Fresh bootstrap sends one claim email');
      const person = await claim(ctx, address);
      await membership(ctx, person.memberId, team.teamId);
      assert.equal((await membership(ctx, boot.agentId, team.teamId)).owner_member_id, person.memberId);
      const after = await agentStatus(ctx, boot.credential);
      assert.equal(after.claimPending, false);
      assert.ok(after.organisations.some(org => org.teamId === team.teamId));
      assert.ok(after.shareOffers.some(offer => offer.teamId === team.teamId));
      const link = mailFor(ctx, address)[0].body.text.match(/https?:\/\/\S+\/api\/auth\/claim\?\S+/)[0];
      const replay = await ctx.request(new URL(link).pathname + new URL(link).search);
      assert.match(replay.headers.get('location') || '', /claim_expired/, 'A claim link must be single-use');
      assert.equal(replay.cookie, '', 'A replay must not issue a fresh browser session');
      await ctx.artifact('claim-domain-evidence.json', { before, after, ownerId: person.memberId, agentId: boot.agentId });
    },
  },
  {
    name: 'onboarding-claimed-owner-poll-second-machine', fast: true,
    async run(ctx) {
      const address = email();
      const first = await bootstrapWithClaim(ctx, address, { agentName: 'Example Agent', machine: 'Laptop' });
      const boot = await ctx.bootstrap(address, { agentName: 'Example Agent', machine: 'Desktop' });
      assert.equal(boot.status, 'link_sent');
      assert.equal(boot.credential, undefined, 'A claimed email must not disclose a credential before click');
      const poll = () => post(ctx, '/api/agents/connect', undefined, { requestId: boot.requestId, pollingToken: boot.pollingToken });
      assert.deepEqual(await poll(), { status: 'pending' });
      expectStatus(await ctx.request('/api/agents/connect', { method: 'POST', body: { requestId: boot.requestId, pollingToken: 'a'.repeat(43) } }), 403, 'Wrong polling token');
      const person = await claim(ctx, address);
      assert.equal(person.memberId, first.memberId);
      const connected = await poll();
      assert.equal(connected.status, 'issued');
      assert.equal(connected.claimPending, false);
      assert.notEqual(connected.agentId, first.agentId);
      assert.deepEqual(await poll(), connected, 'Repeated approved polls must return the same machine credential');
      const page = expectStatus(await ctx.request('/api/app/members', { cookie: person.cookie }), 200, 'Grouped agents');
      for (const agentId of [first.agentId, connected.agentId]) {
        const member = page.members.find(row => row.id === agentId);
        assert.ok(member, 'Both machines must appear under the owner');
        assert.equal(member.ownerId, person.memberId);
      }
      const humans = await ctx.sql`SELECT id FROM members WHERE email = ${address}`;
      assert.equal(humans.length, 1);
      assert.equal((await mcp(ctx, connected.credential, 'hive_agent_status')).claimPending, false);
      await ctx.artifact('machine-grouping.json', page);
    },
  },
  {
    name: 'onboarding-create-concurrent-idempotent-invitation', fast: true,
    async run(ctx) {
      const address = `creator@${domain()}`;
      const owner = await human(ctx, { email: address, name: 'Example Creator' });
      const key = randomUUID();
      const responses = await Promise.all(Array.from({ length: 4 }, () => create(ctx, owner, key)));
      for (const response of responses) assert.deepEqual(response, responses[0]);
      const team = responses[0];
      assert.deepEqual(Object.keys(team).sort(), ['invitePrompt', 'joinPaused', 'joinUrl', 'teamId', 'teamName']);
      assert.deepEqual(await create(ctx, owner, key), team);
      assert.equal(team.joinPaused, false);
      assert.equal(new URL(team.joinUrl).origin, new URL(ctx.url).origin);
      assert.match(new URL(team.joinUrl).pathname, /^\/j\/[a-z]+-[a-z]+-[a-z]+$/);
      assert.ok(team.invitePrompt.includes(team.joinUrl));
      assert.ok(team.invitePrompt.includes(team.teamName));
      ctx.output?.(team.invitePrompt, 'creation invitation');
      assert.equal((await membership(ctx, owner.memberId, team.teamId)).role, 'admin');
      const domains = await ctx.sql`SELECT domain FROM team_domains WHERE team_id = ${team.teamId}`;
      assert.deepEqual(domains.map(row => row.domain), [address.split('@')[1]]);
      assert.equal((await ctx.sql`SELECT phrase FROM hive_join_phrases WHERE team_id = ${team.teamId} AND retired_at IS NULL`).length, 1);
      const sent = mailFor(ctx, address).filter(event => event.body.text.includes(team.joinUrl));
      assert.equal(sent.length, 1, 'Concurrent creation must deliver one creation email');
      assert.ok(sent[0].body.text.includes(team.invitePrompt));
      const second = await create(ctx, owner);
      assert.notEqual(second.teamId, team.teamId);
      assert.equal(second.joinPaused, true, 'A domain already owned by another hive must not enable a second hive');
      await ctx.artifact('creation.json', { responses, second, domains });
    },
  },
  {
    name: 'onboarding-domain-phrase-member-invite', fast: true,
    async run(ctx) {
      const workDomain = domain();
      const person = await human(ctx, { email: `member@${workDomain}`, name: 'Example Member' });
      const agent = await bootstrapWithClaim(ctx, `member@${workDomain}`, { machine: 'Member Laptop' });
      const team = await organisation(ctx, workDomain);
      await membership(ctx, person.memberId, team.teamId, false);
      const joined = await post(ctx, '/api/app/join-phrase', person.cookie, { phrase: team.phrase });
      assert.equal(joined.teamName, team.teamName);
      assert.equal(joined.destination, '/app?joined=1');
      assert.equal((await membership(ctx, person.memberId, team.teamId)).role, 'member');
      await membership(ctx, agent.agentId, team.teamId);
      const key = await post(ctx, '/api/app/keys', person.cookie, { label: 'Example member invite' }, 201);
      const invite = await mcp(ctx, key.apiKey, 'hive_invite_link');
      assert.equal(invite.teamName, team.teamName);
      assert.equal(new URL(invite.joinUrl).pathname, `/j/${team.phrase}`);
      assert.ok(invite.invitePrompt.includes(invite.joinUrl));
      assert.equal(invite.joinPaused, false);
      ctx.output?.(invite.invitePrompt, 'member invitation');
      expectStatus(await ctx.request('/api/app/join-phrase/admin', { method: 'POST', cookie: person.cookie, headers: headers(ctx), body: { teamId: team.teamId, action: 'rotate' } }), 403, 'Members cannot rotate the invitation');
      await assertShares(ctx, person.memberId, team.teamId, []);
      await ctx.artifact('member-invitation.json', invite);
    },
  },
  {
    name: 'onboarding-person-wide-invitations-current-and-future', fast: true,
    async run(ctx) {
      const address = `owner@${domain()}`;
      const owner = await human(ctx, { email: address, name: 'Example Owner' });
      const agent = await bootstrapWithClaim(ctx, address);
      const first = await create(ctx, owner);
      const before = await mcp(ctx, agent.credential, 'hive_invite_link');
      assert.equal(before.invitations.length, 1);
      assert.equal(before.invitations[0].teamId, first.teamId);
      const second = await create(ctx, owner);
      const after = await mcp(ctx, agent.credential, 'hive_invite_link');
      assert.deepEqual(after.invitations.map(item => item.teamId).sort(), [first.teamId, second.teamId].sort());
      const paused = after.invitations.find(item => item.teamId === second.teamId);
      assert.equal(paused.joinPaused, true);
      for (const invitation of after.invitations) {
        assert.equal(typeof invitation.teamName, 'string');
        if (!invitation.joinPaused) assert.ok(invitation.invitePrompt.includes(invitation.joinUrl));
        if (invitation.invitePrompt) ctx.output?.(invitation.invitePrompt, 'person-wide invitation');
      }
      await ctx.artifact('person-wide-invitations.json', { before, after });
    },
  },
  {
    name: 'onboarding-outside-domain-request-slack-approve', fast: true,
    async run(ctx) {
      const team = await organisation(ctx);
      await installSlackFixture(ctx, team);
      const address = email('requester');
      const person = await bootstrapWithClaim(ctx, address);
      const before = ctx.events.length;
      const request = await requestJoin(ctx, team, person);
      await requestJoin(ctx, team, person);
      assert.ok(Math.abs(new Date(request.expires_at) - new Date(request.created_at) - 14 * 86400000) < 5000, 'Requests expire after fourteen days');
      await membership(ctx, person.memberId, team.teamId, false);
      await membership(ctx, person.agentId, team.teamId, false);
      const notifications = ctx.events.slice(before).filter(event => event.kind === 'slack' && event.method === 'chat.postMessage' && event.body.text.includes(address));
      assert.equal(notifications.length, 1, 'Duplicate requests must send one admin Slack notification');
      assert.match(notifications[0].body.text, /Reply approve or decline\./);
      const pending = expectStatus(await ctx.request('/api/app/join-requests', { cookie: team.owner.cookie }), 200, 'Admin requests list');
      assert.equal(pending.requests.length, 1);
      assert.equal(pending.requests[0].email, address);
      assert.ok(pending.requests[0].createdAt.endsWith('Z'));
      expectStatus(await ctx.request('/api/app/join-requests', { method: 'POST', cookie: person.cookie, headers: headers(ctx), body: { id: request.id, decision: 'approve' } }), 403, 'Requester cannot approve themselves');
      await approve(ctx, team, request);
      assert.equal((await membership(ctx, person.memberId, team.teamId)).role, 'member');
      await membership(ctx, person.agentId, team.teamId);
      const status = await agentStatus(ctx, person.credential);
      assert.ok(status.shareOffers.some(offer => offer.teamId === team.teamId));
      await assertShares(ctx, person.memberId, team.teamId, []);
      await ctx.artifact('join-request-approval.json', { request, pending, notifications, status });
    },
  },
  {
    name: 'onboarding-outside-domain-decline-cooldown-expiry', fast: true,
    async run(ctx) {
      const team = await organisation(ctx);
      const address = email('declined');
      const person = await human(ctx, { email: address, name: 'Example Requester' });
      const request = await requestJoin(ctx, team, person);
      await post(ctx, '/api/app/join-requests', team.owner.cookie, { id: request.id, decision: 'decline' });
      const declineMail = mailFor(ctx, address).filter(event => event.body.subject === 'Your Hive join request');
      assert.equal(declineMail.length, 1);
      assert.equal(declineMail[0].body.text, `Your request to join ${team.teamName} was declined.`);
      await membership(ctx, person.memberId, team.teamId, false);
      expectStatus(await ctx.request('/api/app/join-phrase', { method: 'POST', cookie: person.cookie, headers: headers(ctx), body: { phrase: team.phrase } }), 429, 'Declined requester seven-day cooldown');
      expectStatus(await ctx.request('/api/app/join-requests', { method: 'POST', cookie: team.owner.cookie, headers: headers(ctx), body: { id: request.id, decision: 'decline' } }), 409, 'Repeated decline');
      assert.equal(mailFor(ctx, address).filter(event => event.body.subject === 'Your Hive join request').length, 1);
      await ctx.sql`UPDATE hive_join_requests SET decided_at = now() - interval '8 days' WHERE id = ${request.id}`;
      const retry = await requestJoin(ctx, team, person);
      assert.notEqual(retry.id, request.id);
      await ctx.sql`UPDATE hive_join_requests SET expires_at = now() - interval '1 second' WHERE id = ${retry.id}`;
      const listed = expectStatus(await ctx.request('/api/app/join-requests', { cookie: team.owner.cookie }), 200, 'Expired requests omitted');
      assert.deepEqual(listed.requests, []);
      expectStatus(await ctx.request('/api/app/join-requests', { method: 'POST', cookie: team.owner.cookie, headers: headers(ctx), body: { id: retry.id, decision: 'approve' } }), 409, 'An expired request cannot be approved');
      await membership(ctx, person.memberId, team.teamId, false);
      const renewed = await requestJoin(ctx, team, person);
      assert.notEqual(renewed.id, retry.id);
      const [expired] = await ctx.sql`SELECT status FROM hive_join_requests WHERE id = ${retry.id}`;
      assert.equal(expired.status, 'expired');
      await ctx.artifact('request-expiry.json', { first: request.id, retry: retry.id, renewed: renewed.id, timeFixtures: ['declined decision aged eight days', 'retry expiry moved into the past'] });
    },
  },
  {
    name: 'onboarding-slack-approval-undo-window', fast: true,
    async run(ctx) {
      const team = await organisation(ctx);
      const slack = await installSlackFixture(ctx, team);
      const person = await bootstrapWithClaim(ctx, email('undo'));
      const request = await requestJoin(ctx, team, person);
      const [notification] = await ctx.sql`SELECT * FROM hive_join_request_notifications WHERE request_id = ${request.id} AND admin_member_id = ${team.owner.memberId}`;
      assert.equal(notification.status, 'sent', 'The admin must receive the request DM');
      const address = (await ctx.sql`SELECT email FROM hive_join_requests WHERE id = ${request.id}`)[0].email;
      let start = await slackMessage(ctx, slack, notification, 'approve');
      await waitRequest(ctx, request.id, 'approved');
      const approval = await routed(ctx, start);
      assertNoticeFor(approval, request, address);
      assert.deepEqual([approval.tool, approval.toolInput], ['hive_decide_join_request', { decision: 'approve', requestId: request.id }]);
      assert.equal(approval.input.threadContext.lastReversibleAction, null);
      await membership(ctx, person.memberId, team.teamId);
      await membership(ctx, person.agentId, team.teamId);
      start = await slackMessage(ctx, slack, notification, 'undo');
      await waitRequest(ctx, request.id, 'pending');
      const undo = await routed(ctx, start);
      assert.equal(undo.tool, 'undo_last_action');
      assert.deepEqual(undo.input.threadContext.lastReversibleAction, { tool: 'hive_decide_join_request', authorIsSpeaker: true, alreadyUndone: false, withinUndoWindow: true }, 'The routing model must see the approval it can undo');
      assert.equal(undo.input.threadContext.notices[0].status, 'approved');
      await membership(ctx, person.memberId, team.teamId, false);
      await membership(ctx, person.agentId, team.teamId, false);
      await slackMessage(ctx, slack, notification, 'approve');
      const approved = await waitRequest(ctx, request.id, 'approved');
      await membership(ctx, person.memberId, team.teamId);
      await membership(ctx, person.agentId, team.teamId);
      await ctx.sql`UPDATE slack_tool_actions SET expires_at = now() - interval '1 second' WHERE id = ${approved.undo_action_id}`;
      const eventStart = await slackMessage(ctx, slack, notification, 'undo');
      let refusal;
      for (let attempt = 0; attempt < 80; attempt++) {
        refusal = ctx.events.slice(eventStart).find(event => event.kind === 'slack' && event.method === 'chat.postMessage' && /one-hour undo window has ended/i.test(event.body.text ?? ''));
        if (refusal) break;
        await delay(250);
      }
      assert.ok(refusal, 'Undo after one hour must return an explicit refusal');
      const late = await routed(ctx, eventStart);
      assert.equal(late.tool, 'undo_last_action');
      assert.equal(late.input.threadContext.lastReversibleAction.withinUndoWindow, false);
      assert.equal((await ctx.sql`SELECT status FROM hive_join_requests WHERE id = ${request.id}`)[0].status, 'approved');
      await membership(ctx, person.memberId, team.teamId);
      await ctx.artifact('undo-evidence.json', { requestId: request.id, refusal, timeFixture: 'Slack action undo expiry moved into the past' });
    },
  },
  {
    name: 'onboarding-slack-approved-past-tense', fast: true,
    async run(ctx) {
      const { route, jev } = await slackDecision(ctx, () => 'approved');
      assert.equal(route.input.message, 'approved');
      assert.equal(jev.input.request, 'approved');
      await ctx.artifact('routing-evidence.json', { route, jev });
    },
  },
  {
    name: 'onboarding-slack-approve-mailto-markup', fast: true,
    async run(ctx) {
      const { address, route, jev } = await slackDecision(ctx, address => `approve <mailto:${address}|${address}>`);
      assert.equal(route.input.message, `approve ${address}`, 'The routing model must see the address, not Slack link markup');
      assert.equal(jev.input.request, `approve ${address}`);
      await ctx.artifact('routing-evidence.json', { route, jev });
    },
  },
];

scenarios.push({
  name: 'onboarding-bootstrap-email-normalization-rate-limit-expiry', fast: true,
  async run(ctx) {
    const address = email('typed');
    await ctx.resetRateLimits();
    const boot = await ctx.bootstrap(`  ${address.toUpperCase()}  `, { machine: 'Typed Email Laptop' });
    assert.equal(boot.status, 'issued');
    const [owner] = await ctx.sql`SELECT id, email, provisional_expires_at, created_at FROM members WHERE email = ${address}`;
    assert.ok(owner, 'Bootstrap must normalize the human email');
    assert.ok(Math.abs(new Date(owner.provisional_expires_at) - new Date(owner.created_at) - 7 * 86400000) < 5000, 'Unclaimed owners expire after seven days');
    assert.equal(mailFor(ctx, address).length, 1);
    assert.equal((await mcp(ctx, boot.credential, 'hive_agent_status')).claimPending, true);
    for (let machine = 2; machine <= 5; machine++) {
      assert.equal((await ctx.bootstrap(address, { machine: `Example Machine ${machine}` })).status, 'issued');
    }
    assert.equal(mailFor(ctx, address).length, 1, 'Unclaimed additional machines must not duplicate welcome delivery');
    expectStatus(await ctx.request('/api/agents/bootstrap', { method: 'POST', body: { email: address, agentName: 'Example Agent', machine: 'Sixth Machine' } }), 429, 'Sixth bootstrap within an hour');
    const agents = await ctx.sql`SELECT agent_member_id FROM agent_credentials WHERE owner_member_id = ${owner.id}`;
    assert.equal(agents.length, 5, 'Rejected bootstrap must not create another agent');
    await ctx.sql`UPDATE members SET provisional_expires_at = now() - interval '1 second' WHERE id = ${owner.id}`;
    // Production expires owners through this sweep (Vercel cron); it revokes the credentials and clears the credential cache.
    expectStatus(await ctx.request('/api/cron/provisional-accounts', { headers: { authorization: 'Bearer hive-e2e-local-only-cron-secret' } }), 200, 'Provisional expiry sweep');
    expectStatus(await ctx.request('/api/agents/status', { token: boot.credential }), 401, 'Expired provisional owner credential');
    const claimUrl = mailFor(ctx, address)[0].body.text.match(/https?:\/\/\S+\/api\/auth\/claim\?\S+/)[0];
    const expired = await ctx.request(new URL(claimUrl).pathname + new URL(claimUrl).search);
    assert.match(expired.headers.get('location') || '', /claim_expired/);
    await ctx.artifact('bootstrap-limits.json', { email: address, ownerId: owner.id, machines: agents.length, timeFixture: 'Provisional expiry moved into the past' });
  },
});

scenarios.push({
  name: 'onboarding-bootstrap-pending-phrase-claim-request', fast: true,
  async run(ctx) {
    const team = await organisation(ctx);
    const address = email('pending-phrase');
    await ctx.resetRateLimits();
    const boot = await ctx.bootstrap(address, { joinPhrase: team.phrase });
    assert.equal(boot.status, 'issued');
    const before = await agentStatus(ctx, boot.credential);
    assert.equal(before.joinPending, team.phrase);
    const pending = await mcp(ctx, boot.credential, 'hive_join', { phrase: team.phrase });
    assert.equal(pending.status, 'claim_pending');
    const claimUrl = mailFor(ctx, address)[0].body.text.match(/https?:\/\/\S+\/api\/auth\/claim\?\S+/)[0];
    const payload = JSON.parse(Buffer.from(new URL(claimUrl).searchParams.get('token').split('.')[1], 'base64url'));
    assert.equal(payload.joinPhrase, team.phrase, 'Pending invitation must ride on the human claim link');
    const person = await claim(ctx, address);
    await membership(ctx, person.memberId, team.teamId, false);
    await membership(ctx, boot.agentId, team.teamId, false);
    const after = await agentStatus(ctx, boot.credential);
    assert.equal(after.claimPending, false);
    assert.equal(after.joinPending, null);
    assert.equal(after.joinRequests.length, 1);
    assert.equal(after.joinRequests[0].teamId, team.teamId);
    assert.equal(after.joinRequests[0].status, 'requested');
    await ctx.artifact('pending-phrase.json', { before, pending, after });
  },
});

for (const mode of ['all_selected', 'projects', 'not_now']) {
  scenarios.push({
    name: `onboarding-share-${mode.replaceAll('_', '-')}`, fast: true,
    async run(ctx) {
      const team = await organisation(ctx);
      const person = await bootstrapWithClaim(ctx, email('sharing'));
      const projects = ['example.com/fixture/alpha', 'example.com/fixture/beta', 'example.com/fixture/gamma'];
      await selectProjects(ctx, person, projects.slice(0, 2));
      const alpha = await capture(ctx, person.credential, projects[0], 'Alpha retry');
      const beta = await capture(ctx, person.credential, projects[1], 'Beta cache');
      const request = await requestJoin(ctx, team, person);
      await approve(ctx, team, request);
      const offer = (await agentStatus(ctx, person.credential)).shareOffers.find(row => row.teamId === team.teamId);
      assert.ok(offer, 'Joining must offer publication once');
      assert.deepEqual(offer.projects, projects.slice(0, 2).map(pattern => ({ pattern, cells: 1 })));
      await assertShares(ctx, person.memberId, team.teamId, []);
      const instruction = mode === 'all_selected' ? 'Yes, share my selected projects with this organisation now and in the future.' : mode === 'projects' ? 'Share only the alpha project with this organisation.' : 'Not now. Keep my learnings personal.';
      const input = { teamId: team.teamId, mode, projects: mode === 'projects' ? [projects[0]] : [], humanInstruction: instruction };
      const published = mode === 'projects'
        ? await post(ctx, '/api/app/share-on-join', person.cookie, input)
        : await mcp(ctx, person.credential, 'hive_share_with', input);
      assert.equal(published.mode, mode);
      assert.equal(published.published, mode === 'all_selected' ? 2 : mode === 'projects' ? 1 : 0);
      const initialIds = mode === 'all_selected' ? [alpha, beta] : mode === 'projects' ? [alpha] : [];
      await assertShares(ctx, person.memberId, team.teamId, initialIds);
      const grants = await ctx.sql`SELECT grant_kind, repo_pattern, human_instruction FROM project_sharing_grants WHERE owner_member_id = ${person.memberId} AND team_id = ${team.teamId} AND withdrawn_at IS NULL`;
      assert.equal(grants.length, mode === 'not_now' ? 0 : 1);
      if (grants[0]) {
        assert.equal(grants[0].human_instruction, instruction);
        assert.equal(grants[0].grant_kind, mode === 'all_selected' ? 'all_selected' : 'project');
      }
      assert.equal((await agentStatus(ctx, person.credential)).shareOffers.some(row => row.teamId === team.teamId), false, 'Answered offer must not repeat');
      const futureAlpha = await capture(ctx, person.credential, projects[0], 'Future alpha lock');
      await selectProjects(ctx, person, projects, 1);
      const futureGamma = await capture(ctx, person.credential, projects[2], 'Future gamma transaction');
      const expected = mode === 'all_selected' ? [...initialIds, futureAlpha, futureGamma] : mode === 'projects' ? [...initialIds, futureAlpha] : [];
      await assertShares(ctx, person.memberId, team.teamId, expected);
      const originals = await ctx.sql`SELECT id, team_id FROM learnings WHERE owner_member_id = ${person.memberId} ORDER BY id`;
      assert.equal(originals.length, 4);
      assert.ok(originals.every(row => row.team_id === person.teamId), 'Publication must keep every original in the personal hive');
      await ctx.artifact('publication-evidence.json', { mode, offer, published, grants, originals, expected });
    },
  });
}

scenarios.push({
  name: 'onboarding-share-yes-before-any-capture', fast: true,
  async run(ctx) {
    const team = await organisation(ctx);
    const person = await bootstrapWithClaim(ctx, email('empty-sharing'));
    await approve(ctx, team, await requestJoin(ctx, team, person));
    const offer = (await agentStatus(ctx, person.credential)).shareOffers.find(row => row.teamId === team.teamId);
    assert.deepEqual(offer.projects, []);
    await post(ctx, '/api/app/switch-hive', person.cookie, {teamId: team.teamId});
    const before = await ctx.request('/app/team', {cookie: person.cookie});
    assert.match(before.text, /Share your learnings with/);
    assert.match(before.text, /Hive has not captured anything yet/);
    assert.match(before.text, /Your originals stay in your personal hive, and you can change this later on the Team page/);
    const humanInstruction = 'Share everything Hive captures for me, now and in future.';
    await post(ctx, '/api/app/share-on-join', person.cookie, {teamId:team.teamId, mode:'all_selected', projects:[], humanInstruction});
    const decision = (await ctx.sql`SELECT decision, human_instruction, answered_at FROM join_share_offers WHERE owner_member_id=${person.memberId} AND team_id=${team.teamId}`)[0];
    assert.equal(decision.decision, 'yes');
    assert.equal(decision.human_instruction, humanInstruction);
    assert.ok(decision.answered_at);
    assert.equal((await agentStatus(ctx, person.credential)).shareOffers.some(row => row.teamId === team.teamId), false);
    for (const path of ['/app/team', '/app/team', '/app', '/app/claimed', `/j/${team.phrase}`, '/app/account']) {
      const page = await ctx.request(path, {cookie:person.cookie});
      assert.equal(page.status, 200, `${path} must load`);
      assert.doesNotMatch(page.text, /Share your learnings with/, `${path} must hide the answered offer`);
      if (path === '/app/team' || path === '/app/account') {
        assert.match(page.text, /everything Hive captures for you/);
        assert.match(page.text, /Change/);
      }
    }
    const grants = await ctx.sql`SELECT grant_kind FROM project_sharing_grants WHERE owner_member_id=${person.memberId} AND team_id=${team.teamId} AND withdrawn_at IS NULL`;
    assert.deepEqual([...grants], [{grant_kind:'all_selected'}]);
    await selectProjects(ctx, person, ['example.com/fixture/later']);
    const later = await capture(ctx, person.credential, 'example.com/fixture/later', 'Later selection');
    await assertShares(ctx,person.memberId,team.teamId,[later]);
    await post(ctx, '/api/app/share-on-join',person.cookie,{teamId:team.teamId,mode:'not_now',humanInstruction:'Keep personal.'});
    await assertShares(ctx,person.memberId,team.teamId,[]);
    for (const path of ['/app/team','/app/account']) {
      const page=await ctx.request(path,{cookie:person.cookie});
      assert.doesNotMatch(page.text,/Share your learnings with/);
      assert.match(page.text,/Not sharing with/);
      assert.match(page.text,/Change/);
    }
    await ctx.artifact('empty-sharing-decision.json',{decision,grants,later});
  },
});

scenarios.push({
  name: 'onboarding-join-step-shares-by-default', fast: true,
  async run(ctx) {
    const workDomain = domain();
    const person = await human(ctx, { email: `member@${workDomain}`, name: 'Example Member' });
    const agent = await bootstrapWithClaim(ctx, `member@${workDomain}`, { machine: 'Member Laptop' });
    const cell = await capture(ctx, agent.credential, 'example.com/fixture/default', 'Default capture');
    const team = await organisation(ctx, workDomain);
    const joined = await post(ctx, '/api/app/join-phrase', person.cookie, { phrase: team.phrase, share: true, workAreas: 'frontend React, dbt models' });
    assert.deepEqual(joined.sharing, { decision: 'yes', published: 1 });
    await assertShares(ctx, person.memberId, team.teamId, [cell]);
    const originals = await ctx.sql`SELECT team_id FROM learnings WHERE id = ${cell}`;
    assert.notEqual(originals[0].team_id, team.teamId, 'The original must stay in the personal hive');
    assert.equal((await mcp(ctx, agent.credential, 'hive_share_projects', { revision: 0 })).workAreas, 'frontend React, dbt models');
    const later = await capture(ctx, agent.credential, 'example.com/fixture/later', 'Later default capture');
    await assertShares(ctx, person.memberId, team.teamId, [cell, later]);
    const app = await ctx.request('/app', { cookie: person.cookie });
    assert.doesNotMatch(app.text, /Share your learnings/);
  },
});

scenarios.push({
  name: 'onboarding-join-step-decline-keeps-personal', fast: true,
  async run(ctx) {
    const workDomain = domain();
    const person = await human(ctx, { email: `member@${workDomain}`, name: 'Example Member' });
    const agent = await bootstrapWithClaim(ctx, `member@${workDomain}`, { machine: 'Member Laptop' });
    await capture(ctx, agent.credential, 'example.com/fixture/default', 'Declined capture');
    const team = await organisation(ctx, workDomain);
    const page = await ctx.request(`/j/${team.phrase}`, { cookie: person.cookie });
    assert.equal(page.status, 200);
    const text = page.text.replace(/<!-- -->/g, '');
    assert.match(text, /Share what Hive learns with/, 'The join landing must offer sharing');
    assert.match(text, /type="checkbox"[^>]*checked=""/, 'Sharing must be pre-selected on the join landing');
    assert.match(text, /now and in future\. Your originals stay [^.]*, and you can change this later on the Team page/);
    const joined = await post(ctx, '/api/app/join-phrase', person.cookie, { phrase: team.phrase, share: false });
    assert.deepEqual(joined.sharing, { decision: 'not_now', published: 0 });
    await assertShares(ctx, person.memberId, team.teamId, []);
    const decision = (await ctx.sql`SELECT decision FROM join_share_offers WHERE owner_member_id = ${person.memberId} AND team_id = ${team.teamId}`)[0];
    assert.equal(decision.decision, 'not_now');
  },
});

scenarios.push({
  name: 'onboarding-invitation-keeps-local-origin', fast: true,
  async run(ctx) {
    const team = await organisation(ctx);
    await ctx.artifact('invitation.json', team);
    assert.equal(new URL(team.joinUrl).origin, ctx.url);
    const links = team.invitePrompt.match(/https?:\/\/[^\s]+/g) || [];
    assert.ok(links.length >= 2, 'The team prompt must contain the setup and join links');
    for (const link of links) assert.equal(new URL(link).origin, ctx.url, `The team prompt must keep agents on PUBLIC_URL: ${link}`);
  },
});

export default scenarios;
