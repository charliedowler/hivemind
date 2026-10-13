import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installerIdentity, harness, displayName } from '../dist/identity.js';
import { markInstructions } from '../dist/installer.js';

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

test('both installed instruction variants reuse accounts, selections and join links', () => {
  for (const agent of ['claude', 'codex', 'executor']) {
    const text = markInstructions('', agent);
    for (const term of ['skip installation and account creation', 'hive_join', 'Open <joinUrl> to join <team>', 'hive_share_projects', 'skip the project question', 'capture nothing', 'Never ask the human to sign up', 'hive_outcome', 'unhelpful when a cell misled you', 'include_history: true', 'never vote on cells merely retrieved']) assert.ok(text.includes(term), term);
  }
});
