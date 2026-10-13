import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMachine } from '../src/machine.mjs';
import { installationDecision, installerProtocol, loadPolicy, applyProjectAnswer, assertHumanOutput } from '../src/policy.mjs';
import { bootstrapWithClaim, human, claim } from '../fixtures/humans.mjs';
import { completeInstallerOAuth } from '../fixtures/oauth.mjs';

const project = 'example.com/fixture/widget';
const email = prefix => `${prefix}-${randomUUID().slice(0, 8)}@example.com`;

async function withMachine(ctx, options, run) {
  const machine = await createMachine({ ...ctx.machineOptions, url: ctx.url, mode: 'fake', ...options });
  ctx.cleanup?.(() => machine.cleanup());
  try { return await run(machine); }
  finally {
    await ctx.artifact('machine-calls.json', machine.redact(await machine.calls()));
    await machine.cleanup();
    assert.equal(existsSync(machine.root), false, 'Scratch machine must be removed');
  }
}

async function installed(ctx, machine) {
  await ctx.resetRateLimits();
  const result = await machine.install();
  await ctx.artifact('installer-process.json', machine.redact(result));
  assert.equal(result.status, 0, result.stderr);
  ctx.output?.(result.stdout, 'installer');
  return loadPolicy(ctx, machine);
}

async function hookSetup(ctx, machine, selected = true) {
  const policy = await installed(ctx, machine);
  const owner = await bootstrapWithClaim(ctx, email('hook'));
  await machine.setHiveCredential(owner.credential);
  const selection = await applyProjectAnswer(ctx, { token: owner.credential, projects: selected ? [project] : [], humanInstruction: selected ? `Learn only from ${project}` : 'No projects', policy });
  const transcript = await readFile(new URL(`../fixtures/transcripts/${selected ? 'fix' : 'private'}.jsonl`, import.meta.url), 'utf8');
  const path = await machine.write('.hive/fixture.jsonl', transcript);
  await ctx.artifact('hook-transcript.jsonl', transcript);
  await ctx.request('/api/app/capture-rules/effective', { token: owner.credential });
  await ctx.request('/api/app/capture', { method: 'GET', token: owner.credential });
  const version = await ctx.request('/api/cli/version');
  assert.equal(version.status, 200, 'Version metadata must be compiled before timed hooks');
  const telemetry = await ctx.request('/api/analytics/hook', { method: 'GET' });
  assert.equal(telemetry.status, 405, 'Hook telemetry must be compiled before timed hooks');
  return { owner, selection, input: { session_id: randomUUID(), transcript_path: path, agent_transcript_path: path } };
}

async function cells(ctx, owner) {
  return ctx.sql`SELECT id,title,body,repo FROM learnings WHERE team_id=${owner.teamId} ORDER BY id`;
}

const modelCalls = ctx => ctx.events.filter(item => item.kind === 'model' && !/^(?:putPrivateObject|getPrivateObject)$/.test(item.method)).length;

async function recordHook(ctx, machine, event, input, name = event) {
  const result = await machine.hook(event, input);
  await ctx.artifact(`hook-${name}.json`, machine.redact(result));
  assert.equal(result.status, 0, `${event} process must succeed`);
  return result;
}

async function humanLogin(ctx, machine) {
  await installed(ctx, machine);
  const state = JSON.parse(await machine.read('.hive/agent.json'));
  const owner = await claim(ctx, machine.email);
  const result = await machine.exec(machine.executables.node, [machine.paths.installer, 'login'], { env: { CLAUDECODE: '1' } });
  await ctx.artifact('human-login-process.json', machine.redact(result));
  assert.equal(result.status, 0, result.stderr);
  ctx.output(result.stdout, 'human-login');
  assert.equal(existsSync(machine.path('.hive/agent.json')), false, 'Human login must remove the machine agent state');
  const signIn = JSON.parse(await machine.read('.hive/sign-in.json'));
  assert.equal(signIn.identity, 'human');
  assert.ok(signIn.url, 'Explicit login must expose its local OAuth URL');
  assert.equal(new URL(signIn.url).origin, ctx.url);
  const stored = await completeInstallerOAuth(ctx, machine, owner, signIn);
  machine.rememberSecret(stored.access_token);
  machine.rememberSecret(stored.refresh_token);
  assert.ok(stored.refresh_token, 'Human login must save a refreshable OAuth credential');
  assert.equal(stored.baseUrl, ctx.url);
  const denied = await ctx.mcp(state.credential, 'hive_share_projects', { revision: 0 });
  assert.equal(denied.isError, true, 'The previous agent credential must be revoked');
  const connected = await ctx.mcp(stored.access_token, 'hive_invite_link');
  assert.equal(connected.isError, false, connected.text);
  const native = JSON.parse(await machine.read('.claude.json')).mcpServers.hive;
  assert.equal(native.url, `${ctx.url}/api/mcp`);
  assert.equal(native.headers?.Authorization, undefined, 'The agent bearer must not remain in human OAuth configuration');
  const finalState = JSON.parse(await machine.read('.hive/sign-in.json'));
  assert.equal(finalState.phase, 'connected');
  await ctx.artifact('human-login-proof.json', { identity: finalState.identity, phase: finalState.phase, agentRevoked: denied.isError, humanMcpConnected: !connected.isError, refreshTokenSaved: Boolean(stored.refresh_token), callbackResponse: stored.callbackResponse });
  return stored;
}

export default [
  {
    name: 'installer-executor-detection-offer-fallback', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const exec = args => machine.exec(machine.executables.node, [machine.paths.installer, ...args], { env: { HIVE_EXECUTOR_TOOLS: '1', HIVE_NO_AUTO_UPDATE: '1', CLAUDECODE: '1' } });
      const first = await exec(['install']);
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /Executor detection: Detected \(session tools\)/);
      const offer = first.stdout.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(item => item?.status === 'offer_executor');
      assert.ok(offer);
      assert.deepEqual(offer.options.map(item => item.label), ['Yes', 'Not now']);
      assert.ok(!first.stdout.includes('needs_email'));
      const decline = await exec(['install', '--skip-executor']);
      assert.equal(decline.status, 0, decline.stderr);
      assert.ok(decline.stdout.includes('needs_email'));
      assert.equal(JSON.parse(await machine.read('.hive/executor.json')).declined, true);
      assert.ok(!(await exec(['install'])).stdout.includes('offer_executor'));
      const setup = await exec(['install', '--client', 'executor']);
      assert.equal(setup.status, 0, setup.stderr);
      for (const text of ['Add app → Quick Add', 'remote MCP server', `${ctx.url}/api/mcp`, 'Choose OAuth']) assert.ok(setup.stdout.includes(text), text);
      assert.ok(!setup.stdout.includes('needs_email'));
      assert.equal(existsSync(machine.path('.hive/agent.json')), false);
      assert.equal(existsSync(machine.path('.claude/settings.json')), false);
      const instructions = await ctx.request('/agent');
      for (const text of ['HIVE_EXECUTOR_TOOLS=1', 'offer_executor', 'mcp.addServer', 'oauth.start', 'connection link']) assert.ok(instructions.text.includes(text), text);
      const status = await exec(['status']);
      assert.equal(status.status, 0, status.stderr);
      assert.ok(status.stdout.includes('Connection check needed'));
      await ctx.artifact('executor-output.json', { first: first.stdout, decline: decline.stdout, setup: setup.stdout, status: status.stdout });
      assert.equal(ctx.events.filter(item => item.kind === 'mail').length, 0, 'Executor setup sends no claim email');
    }),
  },
  {
    name: 'installer-executor-already-connected-guard', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      await machine.write('.executor/profile-fixture', 'configured');
      const fixture = new URL('../fixtures/bin/executor.mjs', import.meta.url).pathname;
      await writeFile(join(machine.paths.bin, 'executor'), `#!${machine.executables.node}\nimport ${JSON.stringify(fixture)};\n`, { mode: 0o700 });
      const exec = args => machine.exec(machine.executables.node, [machine.paths.installer, ...args], { env: { HIVE_NO_AUTO_UPDATE: '1' } });
      const setup = await exec(['install', '--client', 'executor']);
      assert.equal(setup.status, 0, setup.stderr);
      assert.ok(setup.stdout.includes('Hive is already connected in Executor'));
      assert.ok(!setup.stdout.includes('needs_email'));
      const status = await exec(['status']);
      assert.equal(status.status, 0, status.stderr);
      assert.ok(status.stdout.includes('Executor detection: Detected (CLI, config directory)'));
      assert.ok(status.stdout.includes('Executor: Connected'));
      const calls = (await machine.calls()).filter(item => item.command === 'executor');
      assert.ok(calls.some(item => item.args.includes('getServer')));
      for (const call of calls) assert.ok(!call.args.some(arg => ['addServer', 'registerDynamic', 'start', 'create', 'refresh', 'remove'].includes(arg)), JSON.stringify(call));
      assert.equal(existsSync(machine.path('.hive/agent.json')), false);
      assert.equal(existsSync(machine.path('.claude/settings.json')), false);
      assert.ok((await machine.read('.hive/EXECUTOR.md')).includes('Capture on-signal'));
      await ctx.artifact('executor-output.json', { setup: setup.stdout, status: status.stdout, calls });
      assert.equal(ctx.events.filter(item => item.kind === 'mail').length, 0);
    }),
  },
  {
    name: 'installer-human-login-oauth', fast: true,
    run: ctx => withMachine(ctx, { client: 'claude', email: email('human-login') }, async machine => {
      await humanLogin(ctx, machine);
    }),
  },
  {
    name: 'installer-human-login-keeps-local-origin', fast: true,
    run: ctx => withMachine(ctx, { client: 'claude', email: email('human-redirect') }, async machine => {
      const stored = await humanLogin(ctx, machine);
      const completion = new URL(stored.callbackResponse.location);
      assert.equal(completion.origin, ctx.url, 'Human OAuth completion must stay on the configured Hive origin');
      assert.equal(completion.pathname, '/signed-in');
    }),
  },
  {
    name: 'installer-claude-marker', fast: true,
    run: ctx => withMachine(ctx, { client: 'claude' }, async machine => {
      await installed(ctx, machine);
      const manifest = JSON.parse(await machine.read('.hive/install.json'));
      assert.deepEqual(manifest.agents, ['claude']);
      const settings = JSON.parse(await machine.read('.claude/settings.json'));
      for (const event of ['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'Stop', 'SubagentStop']) assert.ok(settings.hooks[event]?.length, `Installer must register ${event}`);
      assert.equal(existsSync(machine.path('.codex/AGENTS.md')), false);
      await ctx.artifact('installed-settings.json', settings);
      await ctx.artifact('installed-instructions.md', await machine.read('.claude/CLAUDE.md'));
    }),
  },
  {
    name: 'installer-codex-instructions-no-hooks', fast: true,
    run: ctx => withMachine(ctx, { client: 'codex' }, async machine => {
      await installed(ctx, machine);
      assert.deepEqual(JSON.parse(await machine.read('.hive/install.json')).agents, ['codex']);
      assert.ok((await machine.read('.codex/AGENTS.md')).includes('<!-- hive:start -->'));
      assert.ok((await machine.read('.agents/skills/hive/SKILL.md')).includes('hive_push'));
      assert.equal(existsSync(machine.path('.claude/settings.json')), false, 'Codex must not install Claude hooks');
      assert.match(await machine.read('.codex/config.toml'), /\[mcp_servers\.hive\]/);
      await ctx.artifact('installed-config.toml', await machine.read('.codex/config.toml'));
    }),
  },
  ...['claude', 'codex'].map(client => ({
    name: `installer-${client}-local-url`, fast: true,
    run: ctx => withMachine(ctx, { client }, async machine => {
      await installed(ctx, machine);
      const config = client === 'claude' ? JSON.parse(await machine.read('.claude.json')).mcpServers.hive : await machine.read('.codex/config.toml');
      await ctx.artifact('native-mcp-config.json', config);
      const actual = client === 'claude' ? config.url : config.match(/^url = "([^"]+)"$/m)?.[1];
      assert.equal(actual, `${ctx.url}/api/mcp`, 'HIVE_URL must control installed MCP configuration; suspected packages/cli/src/installer.ts:18');
    }),
  })),
  ...['claude', 'codex'].map(client => ({
    name: `installer-${client}-bearer-no-second-auth`, fast: true,
    run: ctx => withMachine(ctx, { client }, async machine => {
      const policy = await installed(ctx, machine);
      if (policy.protocol === 'oauth') {
        const config = client === 'claude' ? JSON.parse(await machine.read('.claude.json')).mcpServers.hive : await machine.read('.codex/config.toml');
        assert.ok(client === 'claude' ? !config.headers?.Authorization : !config.includes('Authorization'), 'Legacy install must keep the OAuth path');
        await ctx.artifact('auth-protocol.json', { protocol: 'oauth', reason: 'Installer version predates agent bootstrap; human OAuth covered separately' });
        return;
      }
      const state = JSON.parse(await machine.read('.hive/agent.json'));
      assert.match(state.credential, /^ha_[A-Za-z0-9_-]{43}$/);
      machine.rememberSecret(state.credential);
      let token;
      if (client === 'claude') token = JSON.parse(await machine.read('.claude.json')).mcpServers.hive.headers.Authorization.replace(/^Bearer /, '');
      else {
        const config = await machine.read('.codex/config.toml');
        token = config.match(/Authorization\s*=\s*"Bearer ([^"]+)"/)?.[1];
        const helper = await machine.exec(machine.executables.node, [machine.path('.codex/skills/hive/scripts/agent-headers.mjs'), machine.home]);
        assert.equal(helper.status, 0, helper.stderr);
        assert.equal(JSON.parse(helper.stdout).Authorization, `Bearer ${state.credential}`, 'Codex header helper must supply the current agent bearer');
      }
      assert.equal(token, state.credential, 'Native MCP must use the installed bearer without another OAuth grant');
      const result = await ctx.mcp(token, 'hive_share_projects', { revision: 0 });
      assert.equal(result.isError, false, result.text);
      assert.ok(!(await machine.calls()).some(call => call.kind === 'browser' || call.args?.includes('login')));
      await ctx.artifact('native-bearer-proof.json', { protocol: policy.protocol, matchesInstalledCredential: token === state.credential, mcpSucceeded: !result.isError, secondAuthInvocations: 0 });
    }),
  })),
  {
    name: 'installer-release-age-refusal', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const result = await machine.exec(`${machine.paths.bin}/npx`, ['gohive@latest', 'install'], { env: { npm_config_minimum_release_age: '1440' } });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /minimum release age/i);
      assert.deepEqual(installationDecision({ refusedMinimumReleaseAge: true }), { action: 'blocked', reason: 'Package release age policy refused installation' });
      assert.equal(existsSync(machine.path('.hive/install.json')), false);
      const calls = await machine.calls();
      assert.equal(calls.filter(call => call.kind === 'cli').length, 1, 'Refusal must not trigger a bypass invocation');
      await ctx.artifact('package-manager-refusal.json', { ...result, scope: 'Deterministic agent policy with a package-manager refusal fixture; no npm registry contacted' });
    }),
  },
  {
    name: 'installer-reuse-no-double-auth', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const policy = await installed(ctx, machine);
      assert.equal(policy.protocol, installerProtocol(await machine.installerVersion()));
      const owner = await bootstrapWithClaim(ctx, email('reuse'));
      await machine.setHiveCredential(owner.credential);
      const doctor = await machine.exec(machine.executables.node, [machine.path('.claude/skills/hive/scripts/doctor.mjs'), '--hooks']);
      await ctx.artifact('hook-doctor.json', machine.redact(doctor));
      assert.equal(doctor.status, 0, 'An existing bearer must connect hooks without a second OAuth flow');
      const callsBefore = await machine.calls();
      assert.deepEqual(installationDecision({ installed: true, authenticated: true }), { action: 'reuse' });
      await machine.install();
      const callsAfter = await machine.calls();
      assert.equal(callsAfter.filter(call => call.args?.includes('add')).length, callsBefore.filter(call => call.args?.includes('add')).length, 'Reinstall must preserve existing MCP registration');
      assert.ok(!callsAfter.some(call => call.kind === 'browser' || call.args?.includes('login')));
    }),
  },
  {
    name: 'hooks-session-start-recalls-canonical-repo', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const { owner, input } = await hookSetup(ctx, machine);
      const captured = await ctx.mcp(owner.credential, 'hive_push', { observation: 'Discovered that the fixture widget cache must be initialised before worker startup.', evidence: { session_excerpt: 'npm test failed before cache creation and passed after cache creation.' }, context: { repo: project, remote: `https://${project}.git`, cwd: machine.cwd, agent: 'claude-code', sessionId: input.session_id, sessionType: 'interactive' } });
      assert.equal(captured.isError, false, captured.text);
      const canonical = await ctx.mcp(owner.credential, 'hive_recent', { repo: project, since: '7d', limit: 3 });
      const withoutHost = await ctx.mcp(owner.credential, 'hive_recent', { repo: 'fixture/widget', since: '7d', limit: 3 });
      await ctx.artifact('session-start-repo-probes.json', { canonical, withoutHost });
      assert.match(canonical.text, /lrn_/, 'Canonical-repo probe must see the actual persisted cell');
      const recent = await recordHook(ctx, machine, 'SessionStart', { ...input, source: 'startup' });
      assert.match(recent.stdout, /Hive recent/, 'SessionStart must fetch and expose the actual selected-repo cell');
    }),
  },
  {
    name: 'hooks-bash-fail-pass-nudges-once', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const { owner, input } = await hookSetup(ctx, machine);
      const before = (await cells(ctx, owner)).length;
      const bash = { ...input, tool_name: 'Bash', tool_input: { command: 'npm test' } };
      await recordHook(ctx, machine, 'PostToolUseFailure', { ...bash, tool_response: { exit_code: 1 } }, 'bash-fail');
      const pass = await recordHook(ctx, machine, 'PostToolUse', { ...bash, tool_response: { exit_code: 0, stdout: '1 test passed' } }, 'bash-pass');
      assert.match(JSON.parse(pass.stdout).hookSpecificOutput.additionalContext, /cause, fix and evidence/);
      const repeat = await recordHook(ctx, machine, 'PostToolUse', { ...bash, tool_response: { exit_code: 0 } }, 'bash-repeat');
      assert.equal(repeat.stdout, '');
      assert.equal((await cells(ctx, owner)).length, before, 'PostToolUse must nudge without capturing on its own');
    }),
  },
  ...['Stop', 'PreCompact', 'SubagentStop'].map(event => ({
    name: `hooks-${event.toLowerCase()}-capture-and-dedupe`, fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const { owner, input } = await hookSetup(ctx, machine);
      assert.equal((await cells(ctx, owner)).length, 0);
      await recordHook(ctx, machine, event, input);
      const first = await cells(ctx, owner);
      await ctx.artifact('captured-cells.json', first);
      assert.equal(first.length, 1, `${event} must persist one cell using the real HTTP capture and MCP routes`);
      const beforeModels = modelCalls(ctx);
      await recordHook(ctx, machine, 'Stop', input, 'dedupe-stop');
      assert.deepEqual(await cells(ctx, owner), first, 'Stop must preserve exactly the first captured cell');
      assert.equal(modelCalls(ctx), beforeModels, 'Duplicate sweep must not call models again');
    }),
  })),
  {
    name: 'hooks-no-project-selection', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const { owner, input } = await hookSetup(ctx, machine, false);
      const before = modelCalls(ctx);
      const eventStart = ctx.events.length;
      for (const event of ['Stop', 'PreCompact', 'SubagentStop']) await recordHook(ctx, machine, event, input);
      assert.equal((await cells(ctx, owner)).length, 0);
      assert.equal(modelCalls(ctx), before, 'Unselected transcript must be rejected before a model call');
      const http = ctx.events.slice(eventStart).filter(item => item.kind === 'http-server');
      assert.ok(http.some(item => item.method === 'GET' && item.path === '/api/app/capture-rules/effective'), 'Hook must fetch real capture policy before refusing upload');
      assert.ok(!http.some(item => item.method === 'POST' && ['/api/app/capture', '/api/mcp'].includes(item.path)), 'No-selection hooks must never upload transcript text');
    }),
  },

  ...['found', 'typed'].map(answer => ({
    name: `installer-policy-email-${answer}-join-share`, fast: true,
    run: async ctx => {
      const domain = `policy-${randomUUID().slice(0, 8)}.example.test`;
      const admin = await human(ctx, { email: `admin@${domain}`, name: 'Example Admin' });
      const team = await ctx.request('/api/app/create-organisation', { cookie: admin.cookie, body: { requestKey: randomUUID() } });
      assert.equal(team.status, 200, team.text);
      const chosen = `person@${domain}`;
      await withMachine(ctx, { email: answer === 'found' ? chosen : undefined }, async machine => {
        if (installerProtocol(await machine.installerVersion()) === 'oauth') {
          const error = new Error('The legacy OAuth installer has no bootstrap email question; its real PKCE path is covered by onboarding-human-oauth-person-wide-two-organisations');
          error.code = 'E2E_BLOCKED';
          throw error;
        }
        const page = await ctx.request('/agent');
        assert.equal(page.status, 200);
        const first = await machine.exec(machine.executables.node, [machine.paths.installer, 'install'], { env: { CLAUDECODE: '1' } });
        assert.equal(first.status, 0, first.stderr);
        const question = first.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).find(item => item.status === 'needs_email');
        assert.ok(question, 'Installer must return an email question before creating an account');
        assert.equal(question.detectedEmail, answer === 'found' ? chosen : null);
        assertHumanOutput(question.question, { missingDetail: true });
        assert.equal(existsSync(machine.path('.hive/agent.json')), false);
        assert.equal((await ctx.sql`SELECT id FROM members WHERE email=${chosen}`).length, 0);
        machine.email = chosen;
        const phrase = new URL(team.body.joinUrl).pathname.split('/').at(-1);
        await ctx.artifact('setup-deviation.json', { reason: 'The installer rejects local join URLs; exercise the supported phrase input after the separate local-join-URL assertion.', phrase });
        const installed = await machine.install({ args: ['--join-url', phrase] });
        assert.equal(installed.status, 0, installed.stderr);
        ctx.output(installed.stdout, 'installer');
        const policy = await loadPolicy(ctx, machine);
        const state = JSON.parse(await machine.read('.hive/agent.json'));
        assert.ok(state.credential);
        const pending = await applyProjectAnswer(ctx, { token: state.credential, policy });
        assert.equal(pending.state, 'question');
        assertHumanOutput(pending.question, { missingDetail: true });
        await applyProjectAnswer(ctx, { token: state.credential, projects: [project], policy, humanInstruction: `Learn only from ${project}.` });
        const joining = await ctx.mcp(state.credential, 'hive_join', { phrase });
        assert.equal(joining.value.status, 'claim_pending');
        const owner = await claim(ctx, chosen);
        const joined = await ctx.mcp(state.credential, 'hive_join', { phrase });
        assert.equal(joined.isError, false, joined.text);
        const status = await ctx.mcp(state.credential, 'hive_agent_status');
        const offer = status.value.shareOffers.find(item => item.teamId === team.body.teamId);
        assert.ok(offer, 'Claimed membership must expose the sharing question');
        const shareQuestion = `Share your learnings with ${offer.teamName}?`;
        assertHumanOutput(shareQuestion, { missingDetail: true });
        ctx.output(shareQuestion, 'share-offer');
        const sharing = await ctx.mcp(state.credential, 'hive_share_with', { teamId: offer.teamId, mode: 'all_selected', humanInstruction: 'Yes, share all selected projects with this team now and in future.' });
        assert.equal(sharing.isError, false, sharing.text);
        const grants = await ctx.sql`SELECT grant_kind FROM project_sharing_grants WHERE owner_member_id=${owner.memberId} AND team_id=${offer.teamId} AND withdrawn_at IS NULL`;
        assert.equal(grants[0]?.grant_kind, 'all_selected');
        await ctx.artifact('deterministic-agent-answers.json', { question, emailAnswer: chosen, projectQuestion: pending.question, projectAnswer: project, shareQuestion, shareAnswer: 'Yes' });
      });
    },
  })),

  {
    name: 'installer-local-join-url', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const admin = await human(ctx, { email: `admin@join-link-${randomUUID().slice(0, 8)}.example.test`, name: 'Example Admin' });
      const team = await ctx.request('/api/app/create-organisation', { cookie: admin.cookie, body: { requestKey: randomUUID() } });
      assert.equal(team.status, 200, team.text);
      assert.ok(team.body.joinUrl.startsWith(`${ctx.url}/j/`));
      const result = await machine.install({ args: ['--join-url', team.body.joinUrl] });
      await ctx.artifact('local-join-url.json', result);
      assert.equal(result.status, 0, `The installer must accept a join URL on HIVE_URL: ${result.stderr}`);
    }),
  },

  {
    name: 'hooks-stop-does-not-repeat-mid-session-push', fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const { owner, input } = await hookSetup(ctx, machine);
      const transcript = await readFile(input.transcript_path, 'utf8');
      const observation = JSON.parse(transcript.trim().split('\n').at(-1)).message.content[0].text;
      const args = { observation, evidence: { session_excerpt: observation }, context: { repo: project, agent: 'claude-code' } };
      const pushed = await ctx.mcp(owner.credential, 'hive_push', args);
      assert.equal(pushed.isError, false, pushed.text);
      await recordHook(ctx, machine, 'PostToolUse', { ...input, tool_name: 'mcp__hive__hive_push', tool_input: args, tool_response: pushed.raw }, 'mcp-push');
      const before = await cells(ctx, owner);
      assert.equal(before.length, 1);
      const eventStart = ctx.events.length;
      await recordHook(ctx, machine, 'Stop', input);
      assert.deepEqual(await cells(ctx, owner), before);
      assert.equal(ctx.events.slice(eventStart).filter(event => event.kind === 'model').length, 0);
      assert.ok(!ctx.events.slice(eventStart).some(event => event.kind === 'http-server' && event.method === 'POST' && ['/api/app/capture', '/api/mcp'].includes(event.path)));
    }),
  },
  ...['unselected-repo', 'contradictory-repo', 'missing-repo'].map(variant => ({
    name: `hooks-refuses-${variant}`, fast: true,
    run: ctx => withMachine(ctx, {}, async machine => {
      const { owner, input } = await hookSetup(ctx, machine);
      const gitArgs = variant === 'missing-repo' ? ['remote', 'remove', 'origin'] : ['remote', 'set-url', 'origin', 'https://example.com/fixture/unselected.git'];
      assert.equal((await machine.exec(machine.executables.git, gitArgs)).status, 0);
      const eventStart = ctx.events.length;
      await recordHook(ctx, machine, 'Stop', { ...input, ...(variant === 'contradictory-repo' ? { repo: project } : {}) });
      assert.equal((await cells(ctx, owner)).length, 0);
      const events = ctx.events.slice(eventStart);
      assert.equal(events.filter(event => event.kind === 'model').length, 0);
      assert.ok(!events.some(event => event.kind === 'http-server' && event.method === 'POST' && ['/api/app/capture', '/api/mcp'].includes(event.path)), 'Unselected, missing or inconsistent context must not upload transcript text');
    }),
  })),

  {
    name: 'installer-status-member-invitation', fast: false,
    run: ctx => withMachine(ctx, { email: `person@status-${randomUUID().slice(0, 8)}.example.test` }, async machine => {
      await installed(ctx, machine);
      const owner = await claim(ctx, machine.email);
      const created = await ctx.request('/api/app/create-organisation', { cookie: owner.cookie, body: { requestKey: randomUUID() } });
      assert.equal(created.status, 200);
      assert.equal(created.body.joinPaused, false);
      const state = JSON.parse(await machine.read('.hive/agent.json'));
      const invitation = await ctx.mcp(state.credential, 'hive_invite_link');
      assert.ok(invitation.value.invitations.some(item => item.teamId === created.body.teamId && item.invitePrompt));
      const status = await machine.exec(machine.executables.node, [machine.paths.installer, 'status']);
      await ctx.artifact('status-and-invitation.json', { status, invitation: invitation.value });
      ctx.output(status.stdout, 'gohive-status');
      assert.equal(status.status, 0);
      assert.ok(status.stdout.includes(created.body.joinUrl), 'The requested status contract includes the member invitation prompt');
    }),
  },

];
