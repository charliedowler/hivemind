import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository, summary } from '../../../skills/hive/scripts/session-start.mjs';
import { captureContext, effectiveCaptureRules, localCaptureDecision } from '../../../skills/hive/scripts/capture-rules.mjs';
import { callTool } from '../../../skills/hive/scripts/mcp.mjs';

const selectedPolicy = {include: ["github.com/team/widget"], exclude: [], revision: 1};
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
  const reports = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/api/app/capture-rules/effective') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rules: [], policy: selectedPolicy })); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(request.headers.authorization, 'Bearer fixture');
    const value = JSON.parse(body);
    if (request.url === '/api/analytics/hook') { reports.push(value); response.writeHead(204).end(); return; }
    calls.push(value);
    if (value.method === 'notifications/initialized') { response.writeHead(202).end(); return; }
    const result = value.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'hive', version: '1' } } : { content: [{ type: 'text', text: responseText }] };
    const message = JSON.stringify({ jsonrpc: '2.0', id: value.id, result });
    if (sse) response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`event: message\ndata: ${message}\n\n`);
    else response.writeHead(200, { 'Content-Type': 'application/json' }).end(message);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { calls, reports, baseUrl: `http://127.0.0.1:${server.address().port}` };
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
  assert.equal(hive.reports.length, 1);
  assert.equal(hive.reports[0].hookKind, 'session_start');
  assert.equal(hive.reports[0].gateDecision, 'capture');
  assert.equal(hive.reports[0].pushedCount, null);
  await run('session-start.mjs', { ...input, session_id: 'another-session' }, env);
  assert.equal(hive.calls.length, 6);
});

test('empty hives and missing credentials leave SessionStart silent', async t => {
  const hive = await mockHive(t, 'No learnings in this time window.');
  const home = scratchRepo();
  assert.equal(await run('session-start.mjs', { session_id: 'empty', cwd: home }, { HOME: home, TMPDIR: home, HIVE_URL: hive.baseUrl, HIVE_KEY: 'fixture' }), '');
  assert.equal(await run('session-start.mjs', { session_id: 'no-token', cwd: home }, { HOME: home, TMPDIR: home, HIVE_URL: hive.baseUrl }), '');
  assert.equal(hive.calls.length, 3);
  assert.equal(hive.reports.length, 1);
  assert.equal(hive.reports[0].gateDecision, 'skip');
});

test('the MCP client reads SSE responses', async t => {
  const hive = await mockHive(t, '- lrn_a: A fact', true);
  const result = await callTool('hive_recent', { repo: 'team/widget' }, { baseUrl: hive.baseUrl, token: 'fixture' });
  assert.equal(result.content[0].text, '- lrn_a: A fact');
});

test('Stop stays silent without credentials, including headless sessions', async () => {
  const home = scratchRepo();
  const transcript = join(home, 'session.jsonl');
  const env = { HOME: home, TMPDIR: home, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' };
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'The repo uses TypeScript.' }] } }));
  assert.equal(await run('stop.mjs', { session_id: 'quiet', transcript_path: transcript }, env), '');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Discovered that the migration lock persists after worker cancellation.' }] } }));
  const input = { session_id: 'learning', transcript_path: transcript };
  assert.equal(await run('stop.mjs', input, env), '');
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
    if (request.url === '/api/app/capture-rules/effective') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rules: [], policy: selectedPolicy })); return; }
    assert.equal(request.url, '/api/app/capture');
    assert.equal(request.headers.authorization, 'Bearer fixture');
    if (request.url === '/api/app/capture-rules/effective') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rules: [], policy: selectedPolicy })); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    captured = JSON.parse(body);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = { HOME: home, TMPDIR: home, HIVE_URL: `http://127.0.0.1:${server.address().port}`, HIVE_KEY: 'fixture' };
  assert.equal(await run('stop.mjs', { cwd: home, session_id: 'jev-skip', transcript_path: transcript }, env), '');
  assert.equal(captured.observations, 1);
  assert.ok(captured.text.length <= 6000);
  decision = 'capture';
  assert.equal(JSON.parse(await run('stop.mjs', { cwd: home, session_id: 'jev-capture', transcript_path: transcript }, env)).decision, 'block');
});

test('Stop fails closed when the capture gate is unavailable', async t => {
  const home = scratchRepo();
  const transcript = join(home, 'failed-capture.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Discovered that a stopped migration worker can leave a lock open.' }] } }));
  const reports = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/api/app/capture-rules/effective') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rules: [], policy: selectedPolicy })); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.url === '/api/app/capture') { response.writeHead(503).end(); return; }
    assert.equal(request.url, '/api/analytics/hook');
    reports.push(JSON.parse(body));
    response.writeHead(204).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = { HOME: home, TMPDIR: home, HIVE_URL: `http://127.0.0.1:${server.address().port}`, HIVE_KEY: 'fixture' };
  assert.equal(await run('stop.mjs', { cwd: home, session_id: 'failed-gate', transcript_path: transcript }, env), '');
  assert.equal(reports.length, 0);
  assert.equal(await run('stop.mjs', { session_id: 'failed-gate', transcript_path: transcript }, env), '');
  assert.equal(reports.length, 0);
});

test('recent summaries preserve lifecycle and verification warnings without author data', () => {
  const context = summary({ content: [{ type: 'text', text: '- lrn_a: Old guidance | superseded, superseded by lrn_b | private author via codex\n- lrn_b: Current guidance | fresh, verify before use | private author via codex' }] }, 'team/widget');
  assert.ok(context.includes('Old guidance [superseded]'));
  assert.ok(context.includes('Current guidance [fresh, verify before use]'));
  assert.ok(!context.includes('private author'));
  assert.equal(context.split('\n').length, 2);
});


test('capture metadata keeps the canonical project and working directory', () => {
  const cwd = scratchRepo();
  const value = captureContext({ cwd, session_id: 'session', agent: 'codex', session_type: 'headless' });
  assert.equal(value.repo, 'team/widget');
  assert.equal(value.remote, 'github.com/team/widget');
  assert.equal(value.cwd, cwd);
  assert.equal(value.agent, 'codex');
  assert.equal(value.sessionType, 'headless');
});

test('policy is fetched afresh for every credential and capture', async t => {
  const home = scratchRepo();
  let requests = 0;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/app/capture-rules/effective');
    requests++;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rules: [{ id: 'fixture', enabled: true }], policy: selectedPolicy }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const options = { home, baseUrl, token: 'one', now: 1000 };
  assert.equal((await effectiveCaptureRules(options)).rules.length, 1);
  await effectiveCaptureRules({ ...options, now: 2000 });
  assert.equal(requests, 2);
  await effectiveCaptureRules({ ...options, token: 'two', now: 2000 });
  await effectiveCaptureRules({ ...options, now: 32000 });
  assert.equal(requests, 4);
});

test('local filtering excludes content rules and keeps non-drop actions server-side', async () => {
  assert.equal((await localCaptureDecision({policy: selectedPolicy, rules: [
    { enabled: true, action: 'drop', kind: 'content_category' },
    { enabled: true, action: 'redact', kind: 'keyword' },
    { enabled: false, action: 'drop', kind: 'repo_match' },
  ]}, { repo: 'team/widget', title: 'Private', body: 'Personal admin' })).action, 'allow');
});

test('a local repo drop never sends transcript text to the capture endpoint', async t => {
  const home = scratchRepo();
  const transcript = join(home, 'private.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Discovered a private repo workaround that must stay on this machine.' }] } }));
  const received = [];
  const server = createServer(async (request, response) => {
    received.push(request.url);
    assert.equal(request.url, '/api/app/capture-rules/effective');
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rules: [{ id: 'private', kind: 'repo_owner', owners: ['team'], mode: 'deny', action: 'drop', enabled: true }], policy: selectedPolicy }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = { HOME: home, TMPDIR: home, HIVE_URL: `http://127.0.0.1:${server.address().port}`, HIVE_KEY: 'fixture' };
  assert.equal(await run('stop.mjs', { cwd: home, session_id: 'private-drop', transcript_path: transcript }, env), '');
  assert.deepEqual(received, ['/api/app/capture-rules/effective']);
});

for (const state of ['outage', 'empty', 'unknown', 'contradiction', 'unselected']) {
  test(`Stop sends no transcript or model gate request for ${state}`, async t => {
    const home = scratchRepo();
    const transcript = join(home, 'blocked.jsonl');
    writeFileSync(transcript, JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text: 'Discovered a private marker that must never be uploaded.'}]}}));
    if (state === 'unknown') execFileSync('git', ['-C', home, 'remote', 'remove', 'origin']);
    const received = [];
    const server = createServer(async (request, response) => {
      let body = ''; for await (const part of request) body += part;
      received.push({url: request.url, body});
      if (state === 'outage') {response.writeHead(503).end(); return;}
      response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({rules: [], policy: {include: state === 'empty' ? [] : state === 'unselected' ? ['github.com/other/repo'] : selectedPolicy.include, exclude: [], revision: 1}}));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    if (state === 'contradiction') {
      const decision = await localCaptureDecision({rules: [], policy: selectedPolicy}, {repo: 'other/repo', remote: 'git@github.com:team/widget.git', title: '', body: ''});
      assert.equal(decision.action, 'drop');
      return;
    }
    const env = {HOME: home, TMPDIR: home, HIVE_URL: `http://127.0.0.1:${server.address().port}`, HIVE_KEY: 'fixture'};
    assert.equal(await run('stop.mjs', {cwd: home, session_id: state, transcript_path: transcript}, env), '');
    assert.deepEqual(received.map(r => r.url), ['/api/app/capture-rules/effective']);
    assert.equal(received[0].body, '');
  });
}
