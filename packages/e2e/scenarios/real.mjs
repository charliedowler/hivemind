import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createMachine } from '../src/machine.mjs';
import { runRealAgent } from '../src/real-agent.mjs';
import { assertHumanOutput, realPrompt } from '../src/policy.mjs';
import { bootstrapWithClaim, claim, human, mailFor } from '../fixtures/humans.mjs';
import { completeInstallerOAuth } from '../fixtures/oauth.mjs';

const project = 'example.com/fixture/widget';
const address = prefix => `${prefix}-${randomUUID().slice(0, 8)}@example.com`;

async function superviseClaims(ctx, email, machine) {
  const controller = new AbortController();
  const seen = new Set(email ? mailFor(ctx, email).map(mail => mail.id) : []);
  let failure;
  let oauthOwner;
  const loop = (async () => {
    while (!controller.signal.aborted) {
      try {
        for (const mail of mailFor(ctx, email).filter(item => /\/api\/auth\/claim\?/.test(item.body?.text || ''))) {
          if (seen.has(mail.id)) continue;
          seen.add(mail.id);
          await claim(ctx, email);
        }
        if (email) {
          const state = JSON.parse(await machine.read('.hive/sign-in.json').catch(() => '{}'));
          if (state.url && !seen.has(state.url)) {
            seen.add(state.url);
            if (ctx.onInstallerAuth) await ctx.onInstallerAuth(machine, { ctx, email, state, protocol: 'oauth', signal: controller.signal });
            else {
              oauthOwner ||= ctx.oauthOwner || await human(ctx, { email, name: 'Fixture Developer' });
              const stored = await completeInstallerOAuth(ctx, machine, oauthOwner, state);
              machine.rememberSecret(stored.access_token);
              machine.rememberSecret(stored.refresh_token);
            }
          }
        }
      } catch (error) { failure = error; break; }
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 250);
        controller.signal.addEventListener('abort', finish, { once: true });
      });
    }
  })();
  return async () => { controller.abort(); await loop; if (failure) throw failure; };
}

async function runMachine(ctx, variant, run) {
  const email = variant.email || address(variant.client || 'claude');
  const deviations = [];
  const machine = await createMachine({
    ...ctx.machineOptions, url: ctx.url, mode: 'real', client: variant.client || 'claude', email: variant.missingDetail ? undefined : variant.gitEmail || email,
    localConfigOverride: true,
    onEvent: async event => { deviations.push(event); await ctx.machineOptions?.onEvent?.(event); },
  });
  ctx.cleanup?.(() => machine.cleanup());
  try {
    let phase = 0;
    const execute = async prompt => {
      const prefix = phase++ ? `continuation-${phase}-` : '';
      const artifact = (name, value) => ctx.artifact(`${prefix}${name}`, value);
      await artifact('agent-prompt.txt', prompt);
      const evidence = await runRealAgent(machine, {
        ...ctx.realAgentOptions, prompt, artifact,
        beforeAgent: ctx.realAgentOptions?.beforeAgent || ((current) => superviseClaims(ctx, variant.missingDetail ? undefined : email, current)),
      });
      ctx.output?.(evidence.text, 'real-agent');
      const invocation = { index: phase, artifactPrefix: prefix, sessionIds: [...new Set(evidence.events.map(event => event.session_id).filter(Boolean))] };
      await artifact('invocation.json', invocation);
      return { ...evidence, finalInvocation: { ...evidence, identity: invocation } };
    };
    const executeSetup = async prompt => {
      const first = await execute(prompt);
      if (first.tools.some(tool => /hive_share_projects$/.test(tool.name)) || !existsSync(machine.path('.hive/install.json'))) return first;
      await machine.syncNativeConfig();
      await ctx.artifact('native-restart.json', { reason: 'A CLI loads native MCP configuration on startup. Start a second bounded invocation after the agent installs Hive, as directed by the product reconnect guidance.' });
      const second = await execute(`${prompt}\nThe agent CLI has now restarted to load the installed MCP server. Reuse the installed connection, run gohive status if waiting for claim, and finish the requested project selection and task with native MCP tools.`);
      return { ...second, text: `${first.text}\n${second.text}`, tools: [...first.tools, ...second.tools], hooks: [...first.hooks, ...second.hooks], events: [...first.events, ...second.events] };
    };
    return await run({ machine, email, execute, executeSetup });
  } finally {
    await ctx.artifact('setup-deviations.json', [...deviations, ...(await machine.calls()).filter(call => call.kind === 'setup-deviation')]);
    await machine.cleanup();
    assert.equal(existsSync(machine.root), false, 'Real credentials and scratch config must be removed');
  }
}

async function verifyOwner(ctx, email) {
  const owners = await ctx.sql`SELECT id,provisional FROM members WHERE lower(email)=${email} AND actor_type='human'`;
  assert.equal(owners.length, 1, 'Real onboarding must create/reuse exactly one owner');
  const agents = await ctx.sql`SELECT agent_member_id AS id FROM agent_credentials WHERE owner_member_id=${owners[0].id} AND revoked_at IS NULL`;
  assert.ok(agents.length, 'Real onboarding must issue an agent identity');
  return { owner: owners[0], agents };
}

function assertSetupTools(evidence) {
  assert.ok(evidence.tools.some(tool => /hive_share_projects$/.test(tool.name)), 'Real agent must read/save project selection through a native MCP tool');
  assertHumanOutput(evidence.text);
}

export default [
  ...['claude', 'codex'].map(client => ({
    name: `real-${client}-fresh-onboarding`, fast: false,
    run: ctx => runMachine(ctx, { client, ...(client === 'claude' ? { gitEmail: address('detected') } : {}) }, async ({ machine, email, executeSetup }) => {
      await ctx.resetRateLimits();
      const result = await executeSetup(realPrompt({ url: ctx.url, email, projects: [project], fix: client === 'claude' }));
      assertSetupTools(result);
      const { owner } = await verifyOwner(ctx, email);
      const selected = await ctx.sql`SELECT include_patterns FROM owner_capture_policies WHERE owner_member_id=${owner.id}`;
      assert.ok(selected.length && selected[0].include_patterns.includes(project), 'Real onboarding must save the answered project');
      if (client === 'claude') {
        const final = result.finalInvocation;
        await ctx.artifact('capture-invocation.json', final.identity);
        const tests = final.tools.filter(tool => tool.name === 'Bash' && /npm test/.test(tool.input?.command || ''));
        const failed = tests.findIndex(tool => /Fixture cache directory is missing/.test(JSON.stringify(tool.result)));
        assert.ok(failed >= 0 && tests.slice(failed + 1).some(tool => /1 test passed/.test(JSON.stringify(tool.result))), 'Native Bash must demonstrate the actual test failure followed by success');
        assert.ok(final.hooks.some(event => /PostToolUse/.test(JSON.stringify(event))), 'Claude must execute its native installed hooks in the final fix invocation');
        assert.ok(final.tools.some(tool => /hive_push$/.test(tool.name)), 'The final fix invocation must capture through native MCP');
        const stop = final.hooks.filter(event => event.subtype === 'hook_response' && event.hook_event === 'Stop' && final.identity.sessionIds.includes(event.session_id));
        await ctx.artifact('native-stop-outcomes.json', stop);
        assert.ok(stop.some(event => event.exit_code === 0 && event.outcome !== 'cancelled'), 'At least one native Stop safety-net hook must finish; cancelled hooks do not prove dedupe');
        const learned = await ctx.sql`SELECT id,body FROM learnings WHERE owner_member_id=${owner.id}`;
        assert.equal(learned.length, 1, 'The actual fix must persist exactly one learning after native Stop dedupe');
        assert.match(learned[0].body, /cache|initialis|initializ/i);
        const wrong = await ctx.sql`SELECT id FROM members WHERE lower(email)=${machine.email}`;
        assert.equal(wrong.length, 0, 'Typed preanswer must override the detected Git email');
      }
      await ctx.artifact('owner-and-agent-counts.json', { owner: owner.id, configPresent: existsSync(machine.path(client === 'claude' ? '.claude.json' : '.codex/config.toml')) });
    }),
  })),
  {
    name: 'real-claude-existing-owner-second-machine', fast: false,
    run: async ctx => {
      const email = address('existing');
      const first = await bootstrapWithClaim(ctx, email, { machine: 'Fixture first machine' });
      const selection = await ctx.mcp(first.credential, 'hive_share_projects', { revision: 0, include: [project], exclude: [], humanInstruction: `Learn from ${project}` });
      assert.equal(selection.isError, false, selection.text);
      await runMachine(ctx, { email }, async ({ executeSetup }) => {
        await ctx.resetRateLimits();
        const result = await executeSetup(realPrompt({ url: ctx.url, email, projects: [project], existing: true }));
        assertSetupTools(result);
        const state = await verifyOwner(ctx, email);
        assert.equal(state.owner.id, first.memberId);
        assert.equal(state.agents.length, 2, 'A second machine must reuse the owner and create exactly one new agent');
        assert.doesNotMatch(result.text, /which.*(?:projects|learn from).*\?/i, 'Existing selection must not be asked again');
      });
    },
  },
  {
    name: 'real-claude-join-and-share', fast: false,
    run: async ctx => {
      const domain = `join-${randomUUID().slice(0, 8)}.example.com`;
      const email = `joining@${domain}`;
      const admin = await human(ctx, { email: `admin@${domain}`, name: 'Fixture Administrator' });
      const created = await ctx.request('/api/app/create-organisation', { method: 'POST', cookie: admin.cookie, body: { requestKey: randomUUID() } });
      assert.equal(created.status, 200, created.text);
      const organisation = created.body;
      const teamId = organisation.teamId || organisation.team?.id;
      const phrase = organisation.joinUrl ? new URL(organisation.joinUrl).pathname.split('/').at(-1) : organisation.phrase || organisation.joinPhrase;
      assert.ok(teamId && phrase, `Creation must expose its team and join phrase: ${created.text}`);
      await runMachine(ctx, { email }, async ({ executeSetup }) => {
        await ctx.resetRateLimits();
        const result = await executeSetup(realPrompt({ url: ctx.url, email, projects: [project], joinUrl: `${ctx.url}/j/${phrase}`, teamName: organisation.teamName, share: `Yes, share all selected projects with ${organisation.teamName}` }));
        assertSetupTools(result);
        const membership = await ctx.sql`SELECT h.member_id FROM hive_memberships h JOIN members m ON m.id=h.member_id WHERE h.team_id=${teamId} AND lower(m.email)=${email} AND h.removed_at IS NULL`;
        assert.equal(membership.length, 1, 'Bootstrap join or native MCP join must connect the requested team');
        assert.ok(result.tools.some(tool => /hive_share_with$/.test(tool.name)), 'Native MCP must record the explicit organisation sharing answer');
        const { owner } = await verifyOwner(ctx, email);
        const grants = await ctx.sql`SELECT repo_pattern FROM project_sharing_grants WHERE owner_member_id=${owner.id} AND team_id=${teamId} AND withdrawn_at IS NULL`;
        assert.ok(grants.some(grant => grant.repo_pattern === '*' || grant.repo_pattern === project), 'Explicit Yes must persist an organisation publication grant');
      });
    },
  },
  {
    name: 'real-claude-outside-domain-request', fast: false,
    run: async ctx => {
      const domain = `outside-${randomUUID().slice(0, 8)}.example.test`;
      const admin = await human(ctx, { email: `admin@${domain}`, name: 'Fixture Administrator' });
      const created = await ctx.request('/api/app/create-organisation', { method: 'POST', cookie: admin.cookie, body: { requestKey: randomUUID() } });
      assert.equal(created.status, 200, created.text);
      assert.ok(created.body.joinUrl);
      await runMachine(ctx, { email: address('outsider') }, async ({ email, executeSetup }) => {
        await ctx.resetRateLimits();
        const result = await executeSetup(realPrompt({ url: ctx.url, email, projects: [project], joinUrl: created.body.joinUrl, teamName: created.body.teamName, share: 'Not now' }));
        assertHumanOutput(result.text);
        assert.match(result.text, /(?:waiting|pending|requested|approval|admin)/i, 'Outside-domain agent must report its pending human approval');
        const requests = await ctx.sql`SELECT status FROM hive_join_requests WHERE team_id=${created.body.teamId} AND email=${email}`;
        assert.equal(requests.length, 1, 'Outside-domain onboarding must create one real join request');
        assert.equal(requests[0].status, 'pending');
      });
    },
  },
  {
    name: 'real-claude-no-selection-bash', fast: false,
    run: ctx => runMachine(ctx, {}, async ({ machine, email, execute }) => {
      await ctx.resetRateLimits();
      const installation = await machine.install();
      assert.equal(installation.status, 0, machine.redact(installation.stderr));
      const owner = (await machine.installerVersion()).startsWith('0.1.') ? await bootstrapWithClaim(ctx, email) : await claim(ctx, email);
      if (owner.credential) await machine.configureNativeBearer(owner.credential);
      const eventStart = ctx.events.length;
      const result = await execute(realPrompt({ url: ctx.url, email, projects: [], existing: true, fix: true }));
      assertHumanOutput(result.text);
      assert.ok(result.tools.some(tool => tool.name === 'Bash' && /npm test/.test(tool.input?.command || '')), 'Real Claude must execute the fixture test');
      assert.ok(existsSync(`${machine.cwd}/fixed.txt`), 'Real Claude must implement the fixture fix');
      assert.ok(result.hooks.length, 'Real Claude must execute installed native hooks');
      assert.ok(!result.tools.some(tool => /hive_push$/.test(tool.name)), 'No selection means no MCP capture');
      const rows = await ctx.sql`SELECT id FROM learnings WHERE team_id=${owner.teamId}`;
      assert.equal(rows.length, 0, 'No selection must persist no cells');
      assert.equal(ctx.events.filter(event => event.kind === 'model').length, 0, 'No selection must reach no Hive model boundary');
      const http = ctx.events.slice(eventStart).filter(event => event.kind === 'http-server');
      assert.ok(http.some(event => event.method === 'GET' && event.path === '/api/app/capture-rules/effective'), 'Native hooks must read real capture policy');
      assert.ok(!http.some(event => event.method === 'POST' && event.path === '/api/app/capture'), 'No-selection hooks must not upload the transcript');
    }),
  },
  {
    name: 'real-claude-missing-detail-question', fast: false,
    run: ctx => runMachine(ctx, { missingDetail: true }, async ({ machine, execute }) => {
      const before = Number((await ctx.sql`SELECT count(*) AS count FROM agent_credentials`)[0].count);
      const result = await execute(realPrompt({ url: ctx.url, projects: [project], missingDetail: true }));
      assertHumanOutput(result.text, { missingDetail: true });
      assert.match(result.text, /email|address/i, 'The missing email must be requested rather than guessed');
      assert.doesNotMatch(result.text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'Do not invent an email');
      assert.equal(Number((await ctx.sql`SELECT count(*) AS count FROM agent_credentials`)[0].count), before);
      assert.ok((await machine.calls()).some(call => call.command === 'curl' && call.args.some(arg => arg === `${ctx.url}/agent`)), 'Agent must consume the real local /agent instructions');
    }),
  },
];
