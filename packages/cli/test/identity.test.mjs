import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { harness, displayName } from '../dist/identity.js';
import { markInstructions } from '../dist/installer.js';

test('harness markers identify the current client', () => {
  assert.equal(harness({ CLAUDECODE: '1' }), 'Claude Code');
  assert.equal(harness({ CODEX_THREAD_ID: 'fixture' }), 'Codex');
  assert.equal(harness({ CODEX_HOME: '/home/config' }), undefined);
});

test('display names remove unsafe characters and fit the local 80-character limit', () => {
  assert.equal(displayName({ CODEX_THREAD_ID: 'fixture' }, 'my\u0000host\u202E'), 'Codex on myhost');
  assert.equal(displayName({ CLAUDECODE: '1' }, '`$(bad)`\n laptop'), 'Claude Code on (bad) laptop');
  assert.ok(displayName({}, 'a'.repeat(100)).length <= 80);
});

test('both installed instruction variants reuse accounts, selections and join links', () => {
  for (const agent of ['claude', 'codex']) {
    const text = markInstructions('', agent);
    for (const term of ['skip installation and account creation', 'hive_join', 'Open <joinUrl> to join <team>', 'hive_share_projects', 'Hive captures by default', 'What kinds of things do you work on that Hive can learn from? Type a few areas, or skip.', 'Yes (Recommended): everything Hive captures for you, now and in future; Choose projects; Not now', 'capture nothing', 'Never ask the human to sign up', 'hive_outcome', 'unhelpful when a cell misled you', 'include_history: true', 'never vote on cells merely retrieved']) assert.ok(text.includes(term), term);
  }
});
