import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository, summary } from '../../../skills/hive/scripts/session-start.mjs';
import { callTool } from '../../../skills/hive/scripts/mcp.mjs';

const scripts = fileURLToPath(new URL('../../../skills/hive/scripts/', import.meta.url));
function run(script, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scripts, script)], { env: { ...process.env, HIVE_KEY: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(stderr)) : resolve(stdout));
    child.stdin.end(JSON.stringify(input));
  });
}

async function mockHive(t, responseText = '- lrn_fixture: Restart the worker before retrying | author via codex | 1h ago | team/widget', sse = false) {
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(request.headers.authorization, 'Bearer fixture');
    const value = JSON.parse(body);
    calls.push(value);
    if (value.method === 'notifications/initialized') { response.writeHead(202).end(); return; }
    const result = value.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'hive', version: '1' } } : { content: [{ type: 'text', text: responseText }] };
    const message = JSON.stringify({ jsonrpc: '2.0', id: value.id, result });
    if (sse) response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`event: message\ndata: ${message}\n\n`);
    else response.writeHead(200, { 'Content-Type': 'application/json' }).end(message);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function scratchRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'gohive-hook-'));
  execFileSync('git', ['init', '-q', directory]);
  execFileSync('git', ['-C', directory, 'remote', 'add', 'origin', 'git@github.com:team/widget.git']);
  return directory;
}

test('repository scope handles HTTPS, SSH and trailing slashes without the hostname', () => {
  assert.equal(repository('git@github.com:team/widget.git'), 'team/widget');
  assert.equal(repository('https://github.com/team/widget.git'), 'team/widget');
  assert.equal(repository('ssh://git@github.com/team/widget'), 'team/widget');
  assert.equal(repository('https://github.com/team/widget/'), 'team/widget');
  assert.equal(repository('/tmp/repo'), undefined);
});

test('the summary keeps at most two short lines and stays silent for no cells', () => {
  assert.equal(summary({ content: [{ type: 'text', text: 'No learnings in this time window.' }] }, 'team/widget'), undefined);
  const context = summary({ content: [{ type: 'text', text: '- lrn_a: Fact one | author\n- lrn_b: Fact two | author\n- lrn_c: Fact three | author\n- lrn_d: Fact four | author' }] }, 'team/widget');
  assert.equal(context.split('\n').length, 2);
  assert.ok(context.includes('Fact three'));
  assert.ok(!context.includes('Fact four'));
});

test('SessionStart runs hive_recent once per session and repo, through real MCP HTTP', async t => {
  const hive = await mockHive(t);
  const home = scratchRepo();
  const env = { HOME: home, TMPDIR: home, HIVE_URL: hive.baseUrl, HIVE_KEY: 'fixture' };
  const input = { session_id: 'fixture-session', cwd: home };
  const first = JSON.parse(await run('session-start.mjs', input, env));
  assert.equal(first.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(first.hookSpecificOutput.additionalContext.split('\n').length, 2);
  assert.deepEqual(hive.calls[2].params, { name: 'hive_recent', arguments: { repo: 'team/widget', since: '7d', limit: 3 } });
  assert.equal(await run('session-start.mjs', input, env), '');
  assert.equal(hive.calls.length, 3);
  await run('session-start.mjs', { ...input, session_id: 'another-session' }, env);
  assert.equal(hive.calls.length, 6);
});

test('empty hives and missing credentials leave SessionStart silent', async t => {
  const hive = await mockHive(t, 'No learnings in this time window.');
  const home = scratchRepo();
  assert.equal(await run('session-start.mjs', { session_id: 'empty', cwd: home }, { HOME: home, TMPDIR: home, HIVE_URL: hive.baseUrl, HIVE_KEY: 'fixture' }), '');
  assert.equal(await run('session-start.mjs', { session_id: 'no-token', cwd: home }, { HOME: home, TMPDIR: home, HIVE_URL: hive.baseUrl }), '');
  assert.equal(hive.calls.length, 3);
});

test('the MCP client reads SSE responses', async t => {
  const hive = await mockHive(t, '- lrn_a: A fact', true);
  const result = await callTool('hive_recent', { repo: 'team/widget' }, { baseUrl: hive.baseUrl, token: 'fixture' });
  assert.equal(result.content[0].text, '- lrn_a: A fact');
});

test('Stop skips quiet sessions and asks at most once without losing headless output', async () => {
  const home = scratchRepo();
  const transcript = join(home, 'session.jsonl');
  const env = { HOME: home, TMPDIR: home, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' };
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'The repo uses TypeScript.' }] } }));
  assert.equal(await run('stop.mjs', { session_id: 'quiet', transcript_path: transcript }, env), '');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Discovered that the migration lock persists after worker cancellation.' }] } }));
  const input = { session_id: 'learning', transcript_path: transcript };
  const first = JSON.parse(await run('stop.mjs', input, env));
  assert.equal(first.decision, 'block');
  assert.ok(first.reason.includes('repeating your previous final answer word for word'));
  assert.ok(first.reason.includes('supersedes'));
  assert.equal(await run('stop.mjs', input, env), '');
  assert.equal(await run('stop.mjs', { ...input, session_id: 'active', stop_hook_active: true }, env), '');
});

test('the packaged Stop hook honours the Jev capture decision and sends bounded facts', async t => {
  const home = scratchRepo();
  const transcript = join(home, 'capture.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Discovered that the installer must track the origin of matching hooks.' }] } }));
  let decision = 'skip';
  let captured;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/api/app/capture');
    assert.equal(request.headers.authorization, 'Bearer fixture');
    let body = '';
    for await (const chunk of request) body += chunk;
    captured = JSON.parse(body);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = { HOME: home, TMPDIR: home, HIVE_URL: `http://127.0.0.1:${server.address().port}`, HIVE_KEY: 'fixture' };
  assert.equal(await run('stop.mjs', { session_id: 'jev-skip', transcript_path: transcript }, env), '');
  assert.equal(captured.observations, 1);
  assert.ok(captured.text.length <= 6000);
  decision = 'capture';
  assert.equal(JSON.parse(await run('stop.mjs', { session_id: 'jev-capture', transcript_path: transcript }, env)).decision, 'block');
});
