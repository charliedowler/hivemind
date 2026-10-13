import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectExecutor, executorEndpoint, doctorExecutor, installExecutor, offerExecutor, declineExecutor, executorState, installExecutorBearer } from '../dist/executor.js';
import { install, updateInstall, markInstructions, url } from '../dist/installer.js';

const ok = data => ({ status: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '' });
const unavailable = () => ({ status: 1, stdout: '', stderr: 'unavailable' });
function fixture({ cli = true, integrations = [], connections = [], fail, client = false, profile = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'gohive-executor-'));
  if (cli && profile) mkdirSync(join(home, '.executor'));
  const calls = [], output = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command !== 'executor' || !cli) return unavailable();
    if (args[0] === '--version') return { status: 0, stdout: 'executor v1.6.8', stderr: '' };
    if (args.includes('--help')) return { status: 0, stdout: '{ name: string; endpoint: string; auth: oauth2 }', stderr: '' };
    if (fail && args.includes(fail)) return unavailable();
    if (args.includes('connections') && args.includes('list')) return ok({ connections });
    if (args.includes('integrations')) return ok({ integrations });
    if (args.includes('getServer')) return ok({ integration: integrations.find(item => item.slug === JSON.parse(args.at(-1)).slug) });
    if (args.includes('probe')) return ok({ issuer: 'https://gohive.dev', authorizationUrl: 'https://gohive.dev/authorize', tokenUrl: 'https://gohive.dev/token', registrationEndpoint: 'https://gohive.dev/register', scopesSupported: ['hive', 'offline_access'] });
    if (args.includes('clients') && args.includes('list')) return ok({ clients: client ? [{ owner: 'user', slug: 'existing', resource: url, grant: 'authorization_code' }] : [] });
    if (args.includes('addServer')) return ok({ slug: 'hive' });
    if (args.includes('registerDynamic')) return ok({ client: 'hive-installer' });
    if (args.includes('start')) return ok({ status: 'redirect', authorizationUrl: 'https://gohive.dev/authorize?state=fixture' });
    throw new Error(`Unexpected Executor call ${args.join(' ')}`);
  };
  return { home, calls, output, options: { home, run, env: {}, log: line => output.push(line) } };
}
const integration = (slug = 'gohive_mcp', endpoint = url) => ({ slug, kind: 'mcp', config: { endpoint } });
const connection = (slug = 'gohive_mcp', status = 'healthy') => ({ integration: slug, owner: 'user', name: 'existing-person', lastHealth: { status } });
const mutations = f => f.calls.filter(args => !args.includes('--help') && ['addServer', 'start', 'registerDynamic', 'create', 'refresh', 'remove'].some(name => args.includes(name)));

test('Executor detects CLI, config directories and session tools independently', () => {
  const cli = fixture({ profile: false });
  assert.deepEqual(detectExecutor(cli.options), { detected: true, cli: true, signals: ['CLI'], version: 'executor v1.6.8' });
  for (const path of ['.executor', '.config/executor', 'custom/executor']) {
    const f = fixture({ cli: false });
    mkdirSync(join(f.home, path), { recursive: true });
    const env = path.startsWith('custom') ? { XDG_CONFIG_HOME: join(f.home, 'custom') } : {};
    assert.deepEqual(detectExecutor({ ...f.options, env }).signals, ['config directory']);
  }
  const f = fixture({ cli: false });
  assert.equal(detectExecutor({ ...f.options, env: { HIVE_EXECUTOR_TOOLS: '1' } }).detected, true);
  assert.equal(detectExecutor({ ...f.options, env: { HIVE_EXECUTOR_TOOLS: '0' } }).detected, false);
  writeFileSync(join(f.home, '.executor'), 'file');
  assert.equal(detectExecutor(f.options).detected, false);
});

test('an unconfigured CLI never starts a daemon or creates an account', () => {
  const f = fixture({ profile: false });
  assert.equal(installExecutor(f.options).status, 'quick_add');
  assert.equal(doctorExecutor(f.options), false);
  assert.ok(f.calls.every(args => args[1] === '--version'));
});

test('MCP metadata remains a detection signal and rejects credential-bearing URLs', () => {
  const f = fixture({ cli: false });
  writeFileSync(join(f.home, '.claude.json'), JSON.stringify({ mcpServers: { executor: { url: 'https://executor.sh/team/mcp' } } }));
  assert.equal(detectExecutor(f.options).endpoint, 'https://executor.sh/team/mcp');
  assert.throws(() => executorEndpoint('https://user:secret@executor.sh/team/mcp'), /without credentials/);
  assert.throws(() => executorEndpoint('https://executor.sh/team/mcp?token=secret'), /without credentials/);
  assert.throws(() => executorEndpoint('http://remote.example/mcp'), /HTTPS/);
});

test('the offer appears once and Not now persists across runs', () => {
  const f = fixture();
  const offer = offerExecutor(f.options);
  assert.equal(offer.status, 'offer_executor');
  assert.deepEqual(offer.picker.options, ['Yes', 'Not now']);
  assert.equal(offer.question, 'You use Executor. Hive can be a connection there too, so every app and agent you run through it shares the same memory. Set it up?');
  assert.deepEqual(offer.options.map(item => item.label), ['Yes', 'Not now']);
  assert.equal(offerExecutor(f.options), undefined);
  declineExecutor(f.home);
  assert.equal(executorState(f.home).declined, true);
  assert.equal(offerExecutor(f.options), undefined);
  assert.equal(offerExecutor(fixture({ cli: false }).options), undefined);
});

test('setup registers one deterministic remote OAuth server and returns the human connection link', () => {
  const f = fixture();
  const result = installExecutor(f.options);
  assert.equal(result.status, 'needs_connection');
  assert.equal(result.link, 'https://gohive.dev/authorize?state=fixture');
  const registration = JSON.parse(mutations(f).find(args => args.includes('addServer')).at(-1));
  assert.deepEqual(registration, { name: 'Hive', slug: 'hive', endpoint: url, transport: 'remote', remoteTransport: 'streamable-http', auth: { kind: 'oauth2' } });
  const start = JSON.parse(mutations(f).find(args => args.includes('start')).at(-1));
  assert.equal(start.owner, 'user');
  assert.equal(start.template, 'oauth2');
  assert.ok(f.output.includes('Click it once to connect; then run `npx gohive status`.'));
  assert.ok(!f.output.join('\n').includes('email'));
  assert.equal(existsSync(join(f.home, '.hive/agent.json')), false);
  assert.ok(f.calls.findIndex(args => args.includes('connections')) < f.calls.findIndex(args => args.includes('addServer')));
});

test('HIVE_URL controls the remote endpoint, OAuth resource and existing guard', () => {
  const f = fixture();
  installExecutor({ ...f.options, env: { HIVE_URL: 'http://localhost:4321' } });
  for (const name of ['addServer', 'registerDynamic']) {
    const input = JSON.parse(mutations(f).find(args => args.includes(name)).at(-1));
    assert.equal(input.endpoint || input.resource, 'http://localhost:4321/api/mcp');
  }
  const existing = fixture({ integrations: [integration('custom', 'http://localhost:4321/api/mcp')], connections: [connection('custom')] });
  assert.equal(installExecutor({ ...existing.options, env: { HIVE_URL: 'http://localhost:4321' } }).status, 'already_connected');
});

test('without a CLI or registration support setup prints three Quick Add lines', () => {
  for (const cli of [false, true]) {
    const f = fixture({ cli });
    const run = (command, args) => args.includes('--help') ? unavailable() : f.options.run(command, args);
    assert.equal(installExecutor({ ...f.options, run }).status, 'quick_add');
    assert.deepEqual(f.output.slice(-3), ['In Executor, choose Add app → Quick Add.', `Choose remote MCP server; name it Hive and use ${url}.`, 'Choose OAuth, then open its connection link and sign in as yourself.']);
    assert.deepEqual(mutations(f), []);
  }
});

test('the guard finds a connected remote server under any slug and only reads Executor', () => {
  const f = fixture({ integrations: [integration('team-memory')], connections: [connection('team-memory')] });
  assert.equal(installExecutor(f.options).status, 'already_connected');
  assert.deepEqual(f.output, ['Hive is already connected in Executor']);
  assert.deepEqual(mutations(f), []);
  assert.equal(doctorExecutor(f.options), true);
  assert.deepEqual(mutations(f), []);
});

test('a connected match wins over an earlier disconnected duplicate app', () => {
  const f = fixture({ integrations: [integration('hive'), integration('other-memory')], connections: [connection('other-memory')] });
  assert.equal(installExecutor(f.options).status, 'already_connected');
  assert.deepEqual(mutations(f), []);
});

test('an existing app needing sign-in is reused along with its authorization-code client', () => {
  const f = fixture({ integrations: [integration()], connections: [connection('gohive_mcp', 'expired')], client: true });
  assert.equal(installExecutor(f.options).status, 'needs_connection');
  assert.ok(!mutations(f).some(args => args.includes('addServer') || args.includes('registerDynamic')));
  const start = JSON.parse(mutations(f).find(args => args.includes('start')).at(-1));
  assert.equal(start.integration, 'gohive_mcp');
  assert.equal(start.name, 'existing-person');
});

test('the guard stops on failed inventory and preserves an occupied slug', () => {
  for (const fail of ['connections', 'integrations', 'getServer']) {
    const f = fixture({ integrations: [integration()], fail });
    assert.equal(installExecutor(f.options).status, 'check_failed');
    assert.deepEqual(mutations(f), []);
  }
  const f = fixture({ integrations: [integration('hive', 'https://other.example/mcp')] });
  assert.equal(installExecutor(f.options).status, 'quick_add');
  assert.deepEqual(mutations(f), []);
});

test('dry-run prints the exact registration command without local or remote changes', () => {
  const f = fixture();
  assert.equal(installExecutor({ ...f.options, dryRun: true }).status, 'dry_run');
  const plan = JSON.parse(f.output[0]);
  assert.deepEqual(plan.command.slice(0, 5), ['executor', 'call', 'executor', 'mcp', 'addServer']);
  assert.equal(JSON.parse(plan.command.at(-1)).name, 'Hive');
  assert.equal(existsSync(join(f.home, '.hive')), false);
  assert.deepEqual(mutations(f), []);
});

test('partial registration failures never start OAuth for an unregistered server', () => {
  const f = fixture({ fail: 'addServer' });
  assert.equal(installExecutor(f.options).status, 'quick_add');
  assert.ok(!mutations(f).some(args => args.includes('start') || args.includes('registerDynamic')));
});

test('status distinguishes missing, expired and healthy connections with no refresh', () => {
  assert.equal(doctorExecutor(fixture().options), false);
  const expired = fixture({ integrations: [integration()], connections: [connection('gohive_mcp', 'expired')] });
  assert.equal(doctorExecutor(expired.options), false);
  assert.ok(expired.output[0].includes('Sign-in needed'));
  const tools = fixture({ cli: false });
  doctorExecutor({ ...tools.options, env: { HIVE_EXECUTOR_TOOLS: '1' } });
  assert.ok(tools.output[0].includes('session tools'));
  assert.deepEqual(mutations(expired), []);
});

test('Executor instruction installation and update keep on-signal capture, project selection and no hooks', () => {
  const f = fixture();
  install({ ...f.options, agents: [], executor: true, registerMcp: false });
  updateInstall(f.options);
  const text = readFileSync(join(f.home, '.hive/EXECUTOR.md'), 'utf8');
  for (const term of ['Executor supplies Hive server instructions', 'Capture on-signal', 'skip the project question', 'Ask once', 'capture nothing', 'hive_push', 'Executor uses no hooks', 'secure connection links']) assert.ok(text.includes(term), term);
  assert.ok(!text.includes('needs_email'));
  assert.equal(existsSync(join(f.home, '.claude/settings.json')), false);
  assert.equal(existsSync(join(f.home, '.claude.json')), false);
  assert.equal(existsSync(join(f.home, '.codex/config.toml')), false);
  assert.equal(markInstructions(text, 'executor').split('<!-- hive:start -->').length, 2);
});

test('legacy Executor bearer setup asks for human OAuth without registering a proxy', () => {
  const f = fixture();
  assert.equal(installExecutorBearer(f.options), false);
  assert.deepEqual(f.calls, []);
});

test('the install CLI offers Executor before email and status reports its detection', () => {
  const home = mkdtempSync(join(tmpdir(), 'gohive-executor-bin-'));
  const bin = new URL('../dist/bin.js', import.meta.url).pathname;
  const env = { ...process.env, HOME: home, CLAUDECODE: '1', HIVE_EXECUTOR_TOOLS: '1', HIVE_NO_AUTO_UPDATE: '1', PATH: '/usr/bin:/bin' };
  const exec = args => execFileSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });
  const first = exec(['install']);
  assert.ok(first.includes('offer_executor'));
  assert.ok(!first.includes('needs_email'));
  assert.equal(existsSync(join(home, '.claude.json')), false);
  assert.ok(exec(['install', '--skip-executor']).includes('needs_email'));
  assert.ok(!exec(['install']).includes('offer_executor'));
  assert.equal(executorState(home).declined, true);
  const status = exec(['status']);
  assert.ok(status.includes('Executor detection: Detected (session tools)'));
  const installed = exec(['install', '--client', 'executor']);
  assert.ok(installed.includes('quick_add'));
  assert.ok(!installed.includes('needs_email'));
  assert.equal(existsSync(join(home, '.hive/agent.json')), false);
  assert.ok(exec(['status']).includes('Connection check needed'));
});
