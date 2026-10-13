import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDatabaseUrl } from '../src/database.mjs';
import { fingerprintRealConfigs, assertRealConfigs, outputViolations, assertQuestion } from '../src/guards.mjs';

test('database guard refuses every non-loopback target before connection', () => {
  assert.throws(() => validateDatabaseUrl('postgres://user:password@db.example.com/hive'), /Remote databases/);
  assert.throws(() => validateDatabaseUrl('postgres://127.0.0.1.example.com/hive'), /Remote databases/);
  assert.throws(() => validateDatabaseUrl('https://127.0.0.1/hive'), /PostgreSQL/);
  assert.equal(validateDatabaseUrl('postgres://127.0.0.1:5432/postgres').hostname, '127.0.0.1');
});

test('fingerprints distinguish an absent config, a created config and changed bytes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hive-e2e-guard-'));
  try {
    const before = await fingerprintRealConfigs(home);
    assertRealConfigs(before, await fingerprintRealConfigs(home));
    await mkdir(join(home, '.claude'));
    await writeFile(join(home, '.claude/settings.json'), '{}');
    const created = await fingerprintRealConfigs(home);
    assert.throws(() => assertRealConfigs(before, created), /configuration changed/);
    await writeFile(join(home, '.claude/settings.json'), '{}\n');
    const changed = await fingerprintRealConfigs(home);
    assert.throws(() => assertRealConfigs(created, changed), /configuration changed/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('human output guards inspect prose and ignore tool identifiers and URLs', () => {
  assert.deepEqual(outputViolations('Call hive_set_capture_rule. Open https://example.com/digest.'), []);
  assert.equal(outputViolations('Reply undo to remove this rule. 2026-10-13T12:30:00Z').length, 3);
  assert.throws(() => assertQuestion('Use this email? Share everything?'));
  assertQuestion('Which project should Hive learn from?');
});
