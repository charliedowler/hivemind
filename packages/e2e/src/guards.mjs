import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

export async function fingerprintRealConfigs(realHome = homedir()) {
  const result = {};
  for (const path of ['.claude.json', '.claude/settings.json', '.codex/config.toml']) {
    try { result[path] = createHash('sha256').update(await readFile(resolve(realHome, path))).digest('hex'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; result[path] = null; }
  }
  return result;
}

export function assertRealConfigs(before, after) {
  assert.deepEqual(after, before, 'The real CLI configuration changed during the harness run.');
}

export function outputViolations(text) {
  const violations = [];
  const cleaned = text.replace(/https?:\/\/\S+|`[^`]*`|\b(?:hive|capture|share|join)_[a-z_]+\b/g, '');
  for (const match of cleaned.matchAll(/\b(comb|nectar|forager|digest|conflict|rule)s?\b/gi)) violations.push({ kind: 'vocabulary', value: match[0] });
  if (/reply\s+["'`]?undo/i.test(cleaned)) violations.push({ kind: 'undo-hint' });
  if (/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cleaned)) violations.push({ kind: 'iso-time' });
  if (/are you sure|shall I proceed|confirm (?:that )?(?:I should|you want)|would you like me to (?:install|save|continue)/i.test(cleaned)) violations.push({ kind: 'extra-confirmation' });
  return violations;
}

export function assertQuestion(text) {
  assert.equal((text.match(/\?/g) || []).length, 1, 'A missing detail must produce exactly one question.');
}
