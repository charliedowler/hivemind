import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { compareVersions, checkForUpdate, runUpdate, takeNotice } from '../../../skills/hive/scripts/auto-update.mjs';
import { install, updateInstall } from '../dist/installer.js';
const fixture = (version = '0.2.0', agents = ['claude']) => {
  const home = mkdtempSync(join(tmpdir(), 'hive-update-'));
  install({ home, agents, registerMcp: false, log: () => {} });
  const manifest = JSON.parse(readFileSync(join(home, '.hive/install.json'), 'utf8'));
  manifest.installedVersion = version;
  writeFileSync(join(home, '.hive/install.json'), JSON.stringify(manifest));
  return home;
};
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const versions = { latest: '0.2.4', minimum: '0.2.0' };
const response = async () => Response.json(versions);
const env = { HIVE_NO_AUTO_UPDATE: '0' };

test('release comparison uses numeric components and rejects executable version strings', () => {
  assert.equal(compareVersions('0.1.9', '0.2.0'), -1);
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  for (const value of ['latest', '1.0.0;echo', '01.2.3', '1.0.0-beta', '999999999999999999999.0.0']) assert.throws(() => compareVersions(value, '1.0.0'));
});

test('a daily cache covers successes and failures, then expires after 24 hours', async () => {
  const home = fixture();
  let checks = 0, updates = 0;
  const options = { home, env, now: 1000000, fetcher: async () => { checks++; return Response.json(versions); }, launch: () => updates++ };
  assert.equal(await checkForUpdate(options), '');
  assert.equal(checks, 1); assert.equal(updates, 1);
  await checkForUpdate({ ...options, now: options.now + 24 * 60 * 60 * 1000 - 1 });
  assert.equal(checks, 1);
  await checkForUpdate({ ...options, now: options.now + 24 * 60 * 60 * 1000 });
  assert.equal(checks, 2);
  const offline = fixture();
  let attempts = 0;
  const failed = { home: offline, env, fetcher: async () => { attempts++; throw Error('offline'); } };
  assert.equal(await checkForUpdate(failed), '');
  assert.equal(await checkForUpdate(failed), '');
  assert.equal(attempts, 1);
});

test('the actual network timeout is quiet and finishes within the two-second budget', async t => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const start = Date.now();
  assert.equal(await checkForUpdate({ home: fixture(), env, baseUrl: `http://127.0.0.1:${server.address().port}` }), '');
  assert.ok(Date.now() - start < 2600);
});

test('opt-out environment and file prevent checks and background installs', async () => {
  for (const file of [false, true]) {
    const home = fixture();
    if (file) writeFileSync(join(home, '.hive/no-auto-update'), '');
    const blockedEnv = file ? env : { HIVE_NO_AUTO_UPDATE: '1' };
    const fail = () => assert.fail('must not check or install');
    assert.equal(await checkForUpdate({ home, env: blockedEnv, fetcher: fail, launch: fail }), '');
    await runUpdate({ home, ...versions, installed: '0.2.0', env: blockedEnv, run: fail });
  }
});

test('invalid metadata, current installs and uninstalled homes never launch updates', async () => {
  for (const metadata of [{ latest: 'latest', minimum: '0.2.0' }, { latest: '0.2.4', minimum: '0.3.0' }, { latest: '0.2.4', minimum: 'x' }]) {
    assert.equal(await checkForUpdate({ home: fixture(), env, fetcher: async () => Response.json(metadata), launch: () => assert.fail() }), '');
  }
  await checkForUpdate({ home: fixture('0.2.4'), env, fetcher: response, launch: () => assert.fail() });
  await checkForUpdate({ home: mkdtempSync(join(tmpdir(), 'hive-empty-')), env, fetcher: () => assert.fail() });
});

test('minimum-version notices report only completed updates and exact failure text once', async () => {
  for (const success of [false, true]) {
    const home = fixture('0.1.9');
    const prompt = await checkForUpdate({ home, env, fetcher: response, launch: () => {} });
    assert.match(prompt, /Hive is updating in the background/);
    assert.equal(takeNotice(home), '');
    await runUpdate({ home, ...versions, installed: '0.1.9', env, run: async () => { if (success) updateInstall({ home }); return success; } });
    assert.equal(takeNotice(home), success ? 'Hive updated to 0.2.4' : 'Hive needs an update: run `npx gohive@latest install`');
    assert.equal(takeNotice(home), '');
  }
  const home = fixture('0.2.0');
  await runUpdate({ home, ...versions, installed: '0.2.0', env, run: async () => false });
  assert.equal(takeNotice(home), '');
});

for (const version of ['0.1.9', '0.2.0']) test(`--update refreshes ${version} without credential, selection or client changes`, () => {
  const home = fixture(version, ['codex']);
  const config = '[mcp_servers.hive]\nurl = "https://gohive.dev/api/mcp"\n' + (version === '0.2.0' ? 'http_headers = { Authorization = "Bearer fixture" }\n' : '');
  writeFileSync(join(home, '.codex/config.toml'), config);
  const selection = '{"include":["github.com/example/*"],"exclude":[],"revision":3}';
  writeFileSync(join(home, '.hive/projects.json'), selection);
  if (version === '0.2.0') writeFileSync(join(home, '.hive/agent.json'), '{"credential":"fixture","agents":["codex"]}');
  const args = [new URL('../dist/bin.js', import.meta.url).pathname, 'install', '--update', '--home', home];
  const commandEnv = { ...process.env, HOME: home, HIVE_HOME: home, CLAUDECODE: '1' };
  for (let i = 0; i < 2; i++) {
    assert.equal(execFileSync(process.execPath, args, { env: commandEnv, encoding: 'utf8' }), '');
    assert.deepEqual(json(join(home, '.hive/install.json')).agents, ['codex']);
    assert.equal(json(join(home, '.hive/install.json')).installedVersion, '0.2.4');
    assert.equal(readFileSync(join(home, '.codex/config.toml'), 'utf8'), config);
    assert.equal(readFileSync(join(home, '.hive/projects.json'), 'utf8'), selection);
    assert.equal(existsSync(join(home, '.claude/settings.json')), false);
  }
  if (version === '0.1.9') { assert.match(takeNotice(home), /kept your OAuth connection/); assert.equal(takeNotice(home), ''); }
  else { assert.equal(readFileSync(join(home, '.hive/agent.json'), 'utf8'), '{"credential":"fixture","agents":["codex"]}'); assert.equal(takeNotice(home), ''); }
});

test('Claude bearer and OAuth MCP files remain byte-identical across update, with one copy of each hook', () => {
  for (const bearer of [false, true]) {
    const home = fixture(bearer ? '0.2.0' : '0.1.9');
    const config = JSON.stringify({ mcpServers: { hive: { type: 'http', url: 'https://gohive.dev/api/mcp', ...(bearer ? { headers: { Authorization: 'Bearer fixture' } } : {}) } }, theme: 'keep' });
    writeFileSync(join(home, '.claude.json'), config);
    if (bearer) writeFileSync(join(home, '.hive/agent.json'), '{"credential":"fixture"}');
    updateInstall({ home }); updateInstall({ home });
    assert.equal(readFileSync(join(home, '.claude.json'), 'utf8'), config);
    for (const groups of Object.values(json(join(home, '.claude/settings.json')).hooks)) assert.equal(groups.length, 1);
    assert.ok(existsSync(join(home, '.claude/skills/hive/scripts/auto-update.mjs')));
  }
});

test('concurrent checks launch once, and local skill changes fail without losing version or credentials', async () => {
  const home = fixture();
  let launched = 0;
  await Promise.all(Array.from({ length: 4 }, () => checkForUpdate({ home, env, fetcher: response, launch: () => launched++ })));
  assert.equal(launched, 1);
  writeFileSync(join(home, '.claude/skills/hive/SKILL.md'), 'local changes');
  assert.throws(() => updateInstall({ home }), /local changes/);
  assert.equal(json(join(home, '.hive/install.json')).installedVersion, '0.2.0');
});

test('the detached updater runs the pinned npx command with an isolated HOME and quiet output', async () => {
  const home = fixture('0.1.9');
  const { startUpdate } = await import('../../../skills/hive/scripts/auto-update.mjs');
  const directory = join(home, 'bin');
  mkdirSync(directory);
  writeFileSync(join(directory, 'npx'), `#!${process.execPath}\nconst fs = require('node:fs');\nconst cp = require('node:child_process');\nconst path = require('node:path');\nfs.writeFileSync(path.join(process.env.HOME, 'update-command.json'), JSON.stringify({ args: process.argv.slice(2), home: process.env.HOME, hiveHome: process.env.HIVE_HOME }));\ncp.execFileSync(process.execPath, [${JSON.stringify(new URL('../dist/bin.js', import.meta.url).pathname)}, 'install', '--update'], { stdio: 'inherit' });\n`, { mode: 0o700 });
  writeFileSync(join(home, '.hive/update.json'), '{}');
  const before = process.env.PATH;
  try {
    process.env.PATH = directory + ':' + before;
    startUpdate({ home, ...versions, installed: '0.1.9' });
  } finally { process.env.PATH = before; }
  for (let i = 0; i < 100 && json(join(home, '.hive/update.json')).status !== 'updated'; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(json(join(home, '.hive/install.json')).installedVersion, '0.2.4');
  assert.deepEqual(json(join(home, 'update-command.json')), { args: ['--yes', 'gohive@0.2.4', 'install', '--update'], home, hiveHome: home });
});

test('unversioned bootstrap installs stay above minimum while OAuth-era assets request the minimum notice', async () => {
  for (const bootstrap of [false, true]) {
    const home = fixture();
    const path = join(home, '.hive/install.json');
    const manifest = json(path);
    delete manifest.installedVersion;
    if (!bootstrap) for (const key of Object.keys(manifest.files)) if (key.endsWith('/scripts/agent-headers.mjs')) delete manifest.files[key];
    writeFileSync(path, JSON.stringify(manifest));
    let installed;
    const notice = await checkForUpdate({ home, env, fetcher: response, launch: args => installed = args.installed });
    assert.equal(installed, bootstrap ? '0.2.0' : '0.1.0');
    if (bootstrap) assert.equal(notice, '');
    else assert.match(notice, /Hive is updating in the background/);
  }
});
