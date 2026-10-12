import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, uninstall, doctor, mergeHooks, markInstructions, runCommand, url } from '../dist/installer.js';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'gohive-fixture-'));
  const servers = new Map();
  const calls = [];
  const output = [];
  const write = (name, text) => { mkdirSync(join(home, name, '..'), { recursive: true }); writeFileSync(join(home, name), text); };
  const run = (command, args, receivedHome) => {
    assert.equal(receivedHome, home);
    calls.push([command, ...args]);
    if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' };
    if (args[1] === 'get') return servers.has(command) ? { status: 0, stdout: JSON.stringify({ transport: { url: servers.get(command) } }), stderr: '' } : { status: 1, stdout: '', stderr: 'No MCP server named hive found' };
    if (args[1] === 'add') {
      servers.set(command, url);
      if (command === 'claude') {
        const config = JSON.parse(existsSync(join(home, '.claude.json')) ? readFileSync(join(home, '.claude.json'), 'utf8') : '{}');
        config.mcpServers = { ...config.mcpServers, hive: { type: 'http', url } };
        write('.claude.json', JSON.stringify(config));
      }
    }
    if (args[1] === 'remove') {
      servers.delete(command);
      if (command === 'claude') {
        const config = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
        delete config.mcpServers.hive;
        write('.claude.json', JSON.stringify(config));
      }
    }
    return { status: 0, stdout: args[1] === 'list' ? command === 'claude' ? `hive: ${url} - Connected` : `hive ${url} enabled OAuth` : '', stderr: '' };
  };
  const options = { home, run, agents: ['claude', 'codex'], log: line => output.push(line) };
  return { home, options, write, calls, output, servers, read: name => readFileSync(join(home, name), 'utf8') };
}

const originalSettings = { theme: 'dark', permissions: { allow: ['Read'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard-existing' }] }], Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'keep-stop' }, { type: 'prompt', prompt: 'Keep this too' }] }] } };

test('merge preserves all settings and hook entries without mutating the input', () => {
  const original = structuredClone(originalSettings);
  const result = mergeHooks(original, '/fixture');
  assert.deepEqual(original, originalSettings);
  assert.deepEqual(result.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.deepEqual(result.hooks.Stop[0], original.hooks.Stop[0]);
  assert.deepEqual(result.permissions, original.permissions);
  assert.equal(result.hooks.SessionStart.length, 1);
  assert.deepEqual(mergeHooks(result, '/fixture'), result);
  assert.deepEqual(mergeHooks(result, '/fixture', true), original);
});

test('removal preserves a different hook in the same group', () => {
  const merged = mergeHooks({}, '/fixture');
  merged.hooks.Stop[0].hooks.push({ type: 'command', command: 'another-hook' });
  const removed = mergeHooks(merged, '/fixture', true);
  assert.deepEqual(removed.hooks.Stop[0].hooks, [{ type: 'command', command: 'another-hook' }]);
});

test('instruction markers update idempotently and preserve text before and after', () => {
  const before = '# My rules\nKeep these\n';
  const added = markInstructions(before, 'codex');
  const withAfter = added + 'After the hive\n';
  assert.equal(markInstructions(withAfter, 'codex'), withAfter);
  assert.equal(markInstructions(withAfter, 'codex', true), before + 'After the hive\n');
  assert.throws(() => markInstructions('<!-- hive:start -->', 'claude'), /incomplete/);
  assert.throws(() => markInstructions(added + added, 'codex'), /duplicated/);
});

test('install backs up files, preserves servers and remains idempotent', () => {
  const f = fixture();
  f.write('.claude/settings.json', JSON.stringify(originalSettings));
  f.write('.claude/CLAUDE.md', '# Existing Claude rules\n');
  f.write('.codex/AGENTS.md', '# Existing Codex rules\n');
  f.write('.codex/config.toml', '[mcp_servers.other]\ncommand="other"\n');
  f.write('.claude.json', JSON.stringify({ mcpServers: { other: { command: 'keep' } } }));
  const backupDir = join(f.home, 'backup');
  const first = install({ ...f.options, backupDir });
  assert.equal(readFileSync(join(backupDir, '.claude/settings.json'), 'utf8'), JSON.stringify(originalSettings));
  assert.equal(readFileSync(join(backupDir, '.codex/config.toml'), 'utf8'), '[mcp_servers.other]\ncommand="other"\n');
  const settings = f.read('.claude/settings.json');
  const instructions = f.read('.codex/AGENTS.md');
  const skill = f.read('.agents/skills/hive/SKILL.md');
  assert.ok(skill.includes('supersedes'));
  assert.equal(f.read('.codex/skills/hive/SKILL.md'), skill);
  assert.deepEqual(JSON.parse(f.read('.claude.json')).mcpServers.other, { command: 'keep' });
  assert.equal(first.registered.length, 2);
  install({ ...f.options, backupDir });
  assert.equal(f.read('.claude/settings.json'), settings);
  assert.equal(f.read('.codex/AGENTS.md'), instructions);
  assert.equal(f.calls.filter(call => call[2] === 'add').length, 2);
  assert.equal(f.read('.codex/config.toml'), '[mcp_servers.other]\ncommand="other"\n');
});

test('malformed JSON and hooks fail before changing any user file', () => {
  for (const text of ['{broken', '{"hooks":[]}', '{"hooks":{"Stop":{}}}', '{"hooks":{"Stop":[{"hooks":false}]}}']) {
    const f = fixture();
    f.write('.claude/settings.json', text);
    f.write('.claude/CLAUDE.md', 'Original');
    assert.throws(() => install(f.options));
    assert.equal(f.read('.claude/settings.json'), text);
    assert.equal(f.read('.claude/CLAUDE.md'), 'Original');
    assert.equal(existsSync(join(f.home, '.codex/AGENTS.md')), false);
    assert.equal(existsSync(join(f.home, '.claude/skills/hive/SKILL.md')), false);
    assert.equal(f.calls.filter(call => call[2] === 'add').length, 0);
  }
});

test('a conflicting Hive server fails without overwriting configuration', () => {
  const f = fixture();
  f.servers.set('codex', 'https://another.example/mcp');
  f.write('.claude/settings.json', '{}');
  assert.throws(() => install(f.options), /different server/);
  assert.equal(f.read('.claude/settings.json'), '{}');
  assert.equal(existsSync(join(f.home, '.claude/CLAUDE.md')), false);
});

test('pre-existing skills and locally edited managed skills are preserved', () => {
  const f = fixture();
  f.write('.claude/skills/hive/SKILL.md', 'Personal skill');
  assert.throws(() => install(f.options), /local changes/);
  assert.equal(f.read('.claude/skills/hive/SKILL.md'), 'Personal skill');
  const second = fixture();
  install(second.options);
  second.write('.claude/skills/hive/SKILL.md', 'Updated personal skill');
  assert.throws(() => install(second.options), /local changes/);
  assert.equal(second.read('.claude/skills/hive/SKILL.md'), 'Updated personal skill');
});

test('uninstall removes only owned entries, keeps edited assets and can repeat', () => {
  const f = fixture();
  f.write('.claude/settings.json', JSON.stringify(originalSettings));
  f.write('.claude/CLAUDE.md', 'Original\n');
  f.write('.claude.json', JSON.stringify({ mcpServers: { other: { command: 'keep' } } }));
  install(f.options);
  f.write('.claude/skills/hive/SKILL.md', 'A user edit');
  uninstall(f.options);
  assert.deepEqual(JSON.parse(f.read('.claude/settings.json')), originalSettings);
  assert.equal(f.read('.claude/CLAUDE.md'), 'Original\n');
  assert.equal(f.read('.claude/skills/hive/SKILL.md'), 'A user edit');
  assert.equal(existsSync(join(f.home, '.codex/skills/hive/SKILL.md')), false);
  assert.deepEqual(JSON.parse(f.read('.claude.json')).mcpServers, { other: { command: 'keep' } });
  assert.equal(f.servers.size, 0);
  uninstall(f.options);
  assert.equal(f.read('.claude/skills/hive/SKILL.md'), 'A user edit');
});

test('uninstall keeps a pre-existing Hive server', () => {
  const f = fixture();
  f.servers.set('codex', url);
  f.write('.claude.json', JSON.stringify({ mcpServers: { hive: { type: 'http', url, headers: { Authorization: 'Bearer fixture' } } } }));
  install(f.options);
  uninstall(f.options);
  assert.equal(f.servers.get('codex'), url);
  assert.equal(JSON.parse(f.read('.claude.json')).mcpServers.hive.url, url);
  assert.equal(f.calls.filter(call => call[2] === 'remove').length, 0);
});

test('doctor reports missing and healthy installations without printing credentials', () => {
  const f = fixture();
  assert.equal(doctor(f.options), false);
  install(f.options);
  f.write('.hive/oauth.json', '{"access_token":"fixture-secret"}');
  assert.equal(doctor(f.options), true);
  assert.ok(!f.output.join('\n').includes('fixture-secret'));
});

test('the runner uses the selected home for all child configuration', () => {
  const home = mkdtempSync(join(tmpdir(), 'gohive-home-'));
  const result = runCommand(process.execPath, ['-e', 'console.log(JSON.stringify({ home:process.env.HOME,codex:process.env.CODEX_HOME,claude:process.env.CLAUDE_CONFIG_DIR,cwd:process.cwd() }))'], home);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { home, codex: join(home, '.codex'), cwd: realpathSync(home) });
});

test('uninstall keeps a matching Hive hook that predates the installer', () => {
  const f = fixture();
  const settings = mergeHooks(originalSettings, f.home);
  f.write('.claude/settings.json', JSON.stringify(settings));
  install(f.options);
  uninstall(f.options);
  assert.deepEqual(JSON.parse(f.read('.claude/settings.json')), settings);
});

test('uninstall validates recorded paths before changing settings', () => {
  const f = fixture();
  install(f.options);
  const settings = f.read('.claude/settings.json');
  const record = JSON.parse(f.read('.hive/install.json'));
  record.files['../unowned-file'] = { hash: 'invalid' };
  f.write('.hive/install.json', JSON.stringify(record));
  assert.throws(() => uninstall(f.options), /unexpected path/);
  assert.equal(f.read('.claude/settings.json'), settings);
  assert.equal(f.calls.filter(call => call[2] === 'remove').length, 0);
});


test('install and uninstall preserve symlinked configuration files', () => {
  const f = fixture();
  f.write('dotfiles/settings.json', JSON.stringify(originalSettings));
  f.write('dotfiles/CLAUDE.md', 'Original rules\n');
  mkdirSync(join(f.home, '.claude'), { recursive: true });
  symlinkSync(join(f.home, 'dotfiles/settings.json'), join(f.home, '.claude/settings.json'));
  symlinkSync(join(f.home, 'dotfiles/CLAUDE.md'), join(f.home, '.claude/CLAUDE.md'));
  install(f.options);
  assert.ok(lstatSync(join(f.home, '.claude/settings.json')).isSymbolicLink());
  assert.ok(lstatSync(join(f.home, '.claude/CLAUDE.md')).isSymbolicLink());
  uninstall(f.options);
  assert.ok(lstatSync(join(f.home, '.claude/settings.json')).isSymbolicLink());
  assert.deepEqual(JSON.parse(f.read('dotfiles/settings.json')), originalSettings);
  assert.equal(f.read('dotfiles/CLAUDE.md'), 'Original rules\n');
});
