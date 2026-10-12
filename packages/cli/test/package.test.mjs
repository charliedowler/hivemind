import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('the Git package includes its runtime and installs the complete skill from packed assets', async () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'gohive-package-'));
  const [pack] = JSON.parse(execFileSync('npm', ['pack', root, '--ignore-scripts', '--json', '--pack-destination', directory], { encoding: 'utf8' }));
  for (const path of ['packages/cli/dist/bin.js', 'packages/cli/dist/installer.js', 'packages/cli/dist/executor.js', 'packages/cli/assets/hive/SKILL.md', 'packages/cli/assets/hive/scripts/telemetry.mjs']) assert.ok(pack.files.some(file => file.path === path), `${path} is missing`);
  execFileSync('tar', ['-xzf', join(directory, pack.filename), '-C', directory]);
  const { install } = await import(pathToFileURL(join(directory, 'package/packages/cli/dist/installer.js')).href);
  const home = join(directory, 'home');
  install({ home, agents: ['claude', 'codex'], registerMcp: false, log: () => {} });
  for (const path of ['.claude/skills/hive/scripts/session-start.mjs', '.claude/skills/hive/scripts/telemetry.mjs', '.agents/skills/hive/SKILL.md', '.codex/skills/hive/SKILL.md']) assert.ok(existsSync(join(home, path)));
});
