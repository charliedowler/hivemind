import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installerIdentity, harness, displayName, knownInbox } from '../dist/identity.js';
import { completeAgentSignIn, markInstructions } from '../dist/installer.js';

test('interactive harness sessions stay human; agent identity needs a explicit flag', () => {
  assert.equal(installerIdentity({}, false), 'human');
  assert.equal(installerIdentity({ CLAUDECODE: '1' }, false), 'human');
  for (const key of ['CODEX_CI', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_VERSION']) assert.equal(installerIdentity({ [key]: 'fixture' }, false), 'human');
  assert.equal(installerIdentity({ TERM_PROGRAM: 'Codex', CODEX_HOME: '/home/config' }, false), 'human');
  assert.equal(installerIdentity({ CLAUDECODE: '1' }, true), 'human');
  assert.equal(installerIdentity({ CLAUDECODE: '1' }, false, 'human'), 'human');
  assert.equal(installerIdentity({}, true, 'agent'), 'agent');
  assert.equal(installerIdentity({}, false, undefined, true), 'agent');
  for (const key of ['CI','HIVE_HEADLESS','HIVE_NO_HUMAN']) for (const value of ['true','1']) assert.equal(installerIdentity({[key]:value, CLAUDECODE:'1'}, false), 'human');
  assert.equal(installerIdentity({CI:'true'}, false, 'agent'), 'agent');
  assert.equal(installerIdentity({CI:'false'}, false), 'human');
  assert.equal(harness({ CLAUDECODE: '1' }), 'Claude Code');
});

test('display names remove unsafe characters and fit the local 80-character limit', () => {
  assert.equal(displayName({ CODEX_THREAD_ID: 'fixture' }, 'my\u0000host\u202E'), 'Codex on myhost');
  assert.equal(displayName({ CLAUDECODE: '1' }, '`$(bad)`\n laptop'), 'Claude Code on (bad) laptop');
  assert.ok(displayName({}, 'a'.repeat(100)).length <= 80);
});

test('known inboxes come from configured addresses and never from an API key alone', () => {
  const home = mkdtempSync(join(tmpdir(), 'hive-identity-'));
  assert.equal(knownInbox({ AGENTMAIL_API_KEY: 'fixture-secret' }, home), undefined);
  assert.equal(knownInbox({ AGENTMAIL_INBOX_ID: 'Known@agentmail.to' }, home), 'known@agentmail.to');
  assert.equal(knownInbox({ AGENTMAIL_EMAIL: '`danger`@agentmail.to' }, home), undefined);
  mkdirSync(join(home, '.config/agentmail'), { recursive: true });
  writeFileSync(join(home, '.config/agentmail/config.json'), JSON.stringify({ inbox_id: 'local@agentmail.to', api_key: 'do-not-print' }));
  assert.equal(knownInbox({}, home), 'local@agentmail.to');
});

test('an already connected account skips AgentID and all credential creation', () => {
  const calls = [];
  const options = { home: '/fixture', agents: ['claude', 'codex'], run: (_command, args) => ({ status: 0, stdout: args[1] === 'list' ? 'hive: Connected' : '', stderr: '' }), log: line => calls.push(line) };
  assert.equal(completeAgentSignIn(options, () => { throw new Error('must skip'); }), true);
  assert.equal(calls.length, 0);
});

test('the agent path authenticates hooks before the native MCP audience and stops on a blocker', () => {
  const calls = [];
  const logs = [];
  const options = { home: '/fixture', agents: ['codex'], run: () => ({ status: 1, stdout: '', stderr: '' }), log: line => logs.push(line) };
  assert.equal(completeAgentSignIn(options, (client, _home, script) => { calls.push([client, script]); return 0; }), true);
  assert.deepEqual(calls.map(call => call[0]), ['hooks', 'codex']);
  assert.ok(calls[0][1].endsWith('/.codex/skills/hive/scripts/login.mjs'));
  calls.length = 0;
  assert.equal(completeAgentSignIn(options, client => { calls.push(client); return 1; }), false);
  assert.deepEqual(calls, ['hooks']);
  assert.equal(logs.length, 1);
});

test('both installed instruction variants reuse accounts, selections and join links', () => {
  for (const agent of ['claude', 'codex', 'executor']) {
    const text = markInstructions('', agent);
    for (const term of ['skip installation and account creation', 'hive_join', 'Open <joinUrl> to join <team>', 'hive_share_projects', 'skip the project question', 'capture nothing', 'Never ask the human to sign up', 'hive_outcome', 'unhelpful when a cell misled you', 'include_history: true', 'never vote on cells merely retrieved']) assert.ok(text.includes(term), term);
  }
});
