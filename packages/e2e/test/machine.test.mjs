import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createMachine, scrubEnvironment, redactEvidence, localUrl } from '../src/machine.mjs';

test('scratch execution isolates configuration and removes files after failure', async () => {
  const machine = await createMachine({ url: 'http://localhost:3000', mode: 'fake', email: 'fixture@example.com' });
  try {
    for (const name of ['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) assert.ok(machine.env[name].startsWith(machine.root + '/'));
    assert.throws(() => machine.path('../outside'), /scratch HOME/);
    await machine.write('.hive/credential.json', { credential: 'synthetic-local-only' });
    const result = await machine.exec(machine.executables.node, ['-e', 'process.exit(19)']);
    assert.equal(result.status, 19);
  } finally { await machine.cleanup(); }
  assert.equal(existsSync(machine.root), false);
  await machine.cleanup();
});

test('abort removes the scratch HOME and terminates its child process', async () => {
  const controller = new AbortController();
  const machine = await createMachine({ url: 'http://localhost:3000', mode: 'fake', signal: controller.signal });
  let childPid;
  const job = machine.exec(machine.executables.node, ['-e', 'console.log(process.pid); setInterval(() => {}, 1000)'], {
    onStdout: text => { childPid = Number(text.trim()); controller.abort(new Error('Fixture abort')); },
  });
  await assert.rejects(job, /Fixture abort/);
  assert.ok(Number.isInteger(childPid));
  assert.equal(existsSync(machine.root), false);
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('provider secrets cannot enter child environment or evidence', () => {
  assert.deepEqual(scrubEnvironment({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'synthetic', OPENAI_API_KEY: 'synthetic', DATABASE_URL: 'remote' }), { PATH: '/usr/bin' });
  const output = redactEvidence({ access_token: 'synthetic-token', text: 'Bearer synthetic-token', nested: { credential: 'synthetic-token' } }, ['synthetic-token']);
  assert.equal(JSON.stringify(output).includes('synthetic-token'), false);
  assert.deepEqual(redactEvidence({ accessToken: 'renewed-access', refreshToken: 'renewed-refresh', idToken: 'renewed-id' }), { accessToken: '[REDACTED]', refreshToken: '[REDACTED]', idToken: '[REDACTED]' });
  assert.throws(() => localUrl('https://gohive.dev'), /loopback/);
  assert.throws(() => localUrl('http://localhost.example.com:3000'), /loopback/);
});
