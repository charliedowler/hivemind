import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectExecutor, executorEndpoint, executorSetupLink, doctorExecutor, installExecutor } from '../dist/executor.js';
import { install, url } from '../dist/installer.js';

mock.method(childProcess, 'spawn', () => ({ on() {}, unref() {} }));
syncBuiltinESMExports();

function fixture({ version = 'executor v1.6.8', integration = null, connections = [], oauth = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'gohive-executor-'));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { executor: { type: 'http', url: 'https://executor.sh/example-team/mcp' } } }));
  const calls = [];
  const output = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'executor' && args[0] === '--version') return { status: version ? 0 : 1, stdout: version || '', stderr: '' };
    if (command !== 'executor') return { status: 1, stdout: '', stderr: 'not found' };
    const data = args.includes('getServer') ? { integration } : args.includes('probeEndpoint') ? { requiresOAuth: oauth, requiresAuthentication: true } : args.includes('refresh') ? { lastHealth: { status: connections[0]?.lastHealth?.status }, tools: [{ name: 'hive_search' }, { name: 'hive_push' }] } : { connections };
    return { status: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '' };
  };
  return { home, calls, output, options: { home, run, log: line => output.push(line) } };
}

test('Executor detection reads endpoint metadata and does not require its credentials', () => {
  const f = fixture();
  assert.deepEqual(detectExecutor(f.options), { detected: true, cli: true, version: 'executor v1.6.8', endpoint: 'https://executor.sh/example-team/mcp' });
  const cloud = fixture({ version: undefined });
  assert.ok(detectExecutor({ ...cloud.options, run: () => ({ status: 1, stdout: '', stderr: '' }) }).detected);
});

test('the org setup URL prefills the MCP URL using the published route', () => {
  const link = new URL(executorSetupLink('https://executor.sh/example-team/mcp'));
  assert.equal(link.pathname, '/example-team/integrations/add/mcp');
  assert.equal(link.searchParams.get('url'), url);
  assert.equal(executorSetupLink('https://mcp.executor.sh/mcp'), 'https://app.executor.sh');
  assert.equal(executorSetupLink(), 'https://app.executor.sh');
  assert.throws(() => executorEndpoint('https://user:secret@executor.sh/team/mcp'), /without credentials/);
  assert.throws(() => executorEndpoint('https://executor.sh/team/mcp?token=secret'), /without credentials/);
  assert.throws(() => executorEndpoint('http://remote.example/mcp'), /HTTPS/);
});

test('the walkthrough stays OAuth-first and performs only read calls', () => {
  const f = fixture({ oauth: false });
  const result = installExecutor(f.options);
  assert.ok(result.link.includes('/example-team/integrations/add/mcp'));
  assert.ok(f.output.some(line => line.includes('OAuth is unavailable')));
  assert.ok(!f.calls.some(call => call.includes('addServer') || call.includes('remove')));
});

test('repeat Executor setup opens an existing integration without replacing it', () => {
  const f = fixture({ integration: { endpoint: url } });
  assert.equal(installExecutor(f.options).link, 'https://executor.sh/example-team/integrations/hive');
  assert.ok(!f.calls.some(call => call.includes('addServer')));
});

test('Executor doctor distinguishes a missing integration and a healthy connection', () => {
  const missing = fixture();
  assert.equal(doctorExecutor(missing.options), false);
  assert.ok(missing.output.some(line => line.includes('missing')));
  const healthy = fixture({ integration: { endpoint: url }, connections: [{ integration: 'hive', owner: 'user', name: 'hive', lastHealth: { status: 'healthy' } }] });
  assert.equal(doctorExecutor(healthy.options), true);
  const newer = fixture({ version: 'executor v2.0.0-beta.16' });
  assert.equal(doctorExecutor(newer.options), false);
  assert.ok(!newer.calls.some(call => call.includes('getServer')));
});

test('Executor skill setup never registers a duplicate direct MCP server', () => {
  const f = fixture();
  install({ ...f.options, agents: ['claude', 'codex'], registerMcp: false });
  assert.ok(!f.calls.some(call => call[1] === 'mcp' && call[2] === 'add'));
  assert.ok(!f.calls.some(call => call[1] === 'mcp' && call[2] === 'get'));
});

test('Executor detects an existing Hive namespace by its endpoint and rejects a different server', () => {
  const f = fixture();
  const run = (command, args) => {
    if (args.includes('getServer') && args.at(-1).includes('gohive_mcp')) return { status: 0, stdout: JSON.stringify({ ok: true, data: { integration: { slug: 'gohive_mcp', config: { endpoint: url } } } }), stderr: '' };
    if (args.includes('integrations')) return { status: 0, stdout: JSON.stringify({ ok: true, data: { integrations: [{ slug: 'gohive_mcp', kind: 'mcp' }] } }), stderr: '' };
    if (args.includes('refresh')) return { status: 0, stdout: JSON.stringify({ ok: true, data: { lastHealth: { status: 'healthy' }, tools: [{ name: 'hive_search' }, { name: 'hive_push' }] } }), stderr: '' };
    if (args.includes('connections')) return { status: 0, stdout: JSON.stringify({ ok: true, data: { connections: [{ integration: 'gohive_mcp', owner: 'user', name: 'hive', lastHealth: { status: 'healthy' } }] } }), stderr: '' };
    return f.options.run(command, args);
  };
  assert.equal(doctorExecutor({ ...f.options, run }), true);
  assert.equal(installExecutor({ ...f.options, run }).link, 'https://executor.sh/example-team/integrations/gohive_mcp');
  const different = fixture({ integration: { slug: 'hive', endpoint: 'https://other.example/mcp' }, connections: [{ integration: 'hive', owner: 'user', name: 'hive', lastHealth: { status: 'healthy' } }] });
  assert.equal(doctorExecutor(different.options), false);
});


test('Executor prefills and probes a new integration without changing policy or headers', () => {
  const f = fixture();
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    let data;
    if (args.includes('addServer')) data = { slug: 'hive' };
    else if (args.includes('probe') && args.includes('oauth')) data = { issuer: 'https://gohive.dev', authorizationUrl: 'https://gohive.dev/auth', tokenUrl: 'https://gohive.dev/token', resource: url, scopesSupported: ['hive'], registrationEndpoint: 'https://gohive.dev/register' };
    else if (args.includes('clients') && args.includes('list')) data = { clients: [] };
    else if (args.includes('registerDynamic')) data = { client: 'hive-installer' };
    else if (args.includes('start')) data = { status: 'redirect', authorizationUrl: 'https://hive.example.test/oauth/authorize?state=fixture' };
    if (data) return { status: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '' };
    return f.options.run(command, args);
  };
  const result = installExecutor({ ...f.options, run, open: true });
  assert.equal(result.link, 'https://hive.example.test/oauth/authorize?state=fixture');
  const added = JSON.parse(calls.find(call => call.includes('addServer')).at(-1));
  assert.equal(added.name, 'Hive');
  assert.equal(added.slug, 'hive');
  assert.equal(added.endpoint, url);
  assert.deepEqual(added.auth, { kind: 'oauth2' });
  assert.equal(added.headers, undefined);
  assert.ok(!calls.some(call => /polic/i.test(call.join(' '))));
  const start = JSON.parse(calls.find(call => call.includes('start')).at(-1));
  assert.equal(start.owner, 'user');
});

test('Executor leaves a different existing server intact and handles a partial API failure', () => {
  const different = fixture({ integration: { slug: 'hive', endpoint: 'https://other.example/mcp' } });
  installExecutor({ ...different.options, open: true });
  assert.ok(!different.calls.some(call => call.includes('addServer') || call.includes('start')));
  const f = fixture();
  const result = installExecutor({ ...f.options, open: true, run: (command, args) => args.includes('addServer') ? { status: 1, stdout: '', stderr: 'API unavailable' } : f.options.run(command, args) });
  assert.ok(result.link.includes('/integrations/add/mcp'));
  assert.ok(!f.calls.some(call => call.includes('registerDynamic')));
});
