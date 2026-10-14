import { mkdir, writeFile, readFile, symlink, rm, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startDatabase } from './database.mjs';
import { startSinks } from './sinks.mjs';
import { start, stop, freePort, command } from './processes.mjs';
import { repoRoot, packageRoot, evidenceRoot, webRoot } from './paths.mjs';

export async function writeArtifact(directory, name, value) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Artifact names must be a single filename.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
}

function localEnvironment() {
  return Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
}

export async function startRuntime({ signal } = {}) {
  const id = randomBytes(7).toString('hex');
  const directory = resolve(evidenceRoot, '_infrastructure');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await command('pnpm', ['--filter', 'gohive', 'build'], { cwd: repoRoot, signal, log: resolve(directory, 'installer-build.log') });
  signal?.throwIfAborted();
  const appDirectory = resolve(packageRoot, '.runtime', id);
  let db, sink, job, closing;
  const close = () => closing ??= (async () => {
    const failures = [];
    for (const action of [() => stop(job?.child), () => sink?.close(), () => db?.close(), () => rm(appDirectory, { recursive: true, force: true })]) {
      try { await action(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Runtime cleanup failed');
  })();
  try {
  db = await startDatabase();
  await writeArtifact(directory, 'database.json', { name: db.name });
  signal?.throwIfAborted();
  sink = await startSinks();
  const port = await freePort();
  const url = `http://localhost:${port}`;
  await mkdir(appDirectory, { recursive: true, mode: 0o700 });
  for (const entry of ['src', 'public']) await cp(resolve(webRoot, entry), resolve(appDirectory, entry), { recursive: true });
  await symlink(resolve(webRoot, 'node_modules'), resolve(appDirectory, 'node_modules'), 'dir');
  await writeFile(resolve(appDirectory, 'next.config.mjs'), `export { default } from ${JSON.stringify(resolve(packageRoot, 'src/next-config.mjs'))};\n`);
  await writeFile(resolve(appDirectory, 'package.json'), JSON.stringify({ name: 'hive-e2e-server', private: true }));
  const tsconfig = JSON.parse(await readFile(resolve(webRoot, 'tsconfig.json'), 'utf8'));
  tsconfig.extends = resolve(webRoot, tsconfig.extends);
  tsconfig.compilerOptions.paths = { '@/*': ['./src/*'] };
  await writeFile(resolve(appDirectory, 'tsconfig.json'), JSON.stringify(tsconfig));
  const commit = (await command('/usr/bin/git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).stdout.trim();
  const env = {
    ...localEnvironment(),
    HOME: resolve(directory, 'server-home'),
    NODE_ENV: 'development',
    DATABASE_URL: db.url,
    PUBLIC_URL: url,
    BETTER_AUTH_URL: url,
    BETTER_AUTH_SECRET: 'hive-e2e-local-only-auth-secret-never-for-production',
    CRON_SECRET: 'hive-e2e-local-only-cron-secret',
    RESEND_API_KEY: 're_e2e_local_only',
    EMAIL_FROM: 'Hive <hive@example.com>',
    HIVE_E2E_SINK_URL: sink.url,
    TYPESAFE_API_KEY: 'e2e-local-only',
    TYPESAFE_BASE_URL: sink.url,
    HIVE_E2E_RUN_ID: id,
    HIVE_E2E_APP_DIR: appDirectory,
    PORT: String(port),
    VERCEL_GIT_COMMIT_SHA: commit,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_C15T_BACKEND_URL: sink.url,
    BLOB_READ_WRITE_TOKEN: 'e2e-local-only',
    SLACK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64'),
    SLACK_SIGNING_SECRET: 'hive-e2e-slack-signing',
  };
  await mkdir(env.HOME, { recursive: true, mode: 0o700 });
  signal?.throwIfAborted();
  job = start(process.execPath, [resolve(packageRoot, 'src/server.mjs')], { cwd: repoRoot, env, log: resolve(directory, 'next.log') });
  job.completed.catch(() => {});
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      signal?.throwIfAborted();
      if (job.child.exitCode !== null) throw new Error(`Next exited: ${JSON.stringify(job.output())}`);
      try {
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
        const health = await response.json();
        if (health.ok && health.commit === commit) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error(`Next did not become ready: ${JSON.stringify(job.output())}`);
    const version = JSON.parse(await readFile(resolve(repoRoot, 'packages/cli/package.json'), 'utf8')).version;
    await writeArtifact(directory, 'provenance.json', { id, commit, version, url, database: db.name, migrations: db.migrations });
    return { id, url, sql: db.sql, events: sink.events, sink, db, env, commit, version, close };
  } catch (error) { await close(); throw error; }
}

export function scenarioContext(runtime, name) {
  const directory = resolve(evidenceRoot, name);
  const trace = [];
  const startIndex = runtime.events.length;
  const cleanups = [];
  const outputs = [];
  let finished;
  let requestId = 0;
  const artifact = (name, value) => writeArtifact(directory, name, value);
  const request = async (path, options = {}) => {
    const target = new URL(path, runtime.url);
    if (target.origin !== runtime.url) throw new Error(`Scenario attempted nonlocal request: ${target.origin}`);
    const { method = options.body === undefined ? 'GET' : 'POST', body, token, cookie, headers = {}, redirect = 'manual' } = options;
    const response = await fetch(target, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', origin: runtime.url }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      redirect,
      signal: AbortSignal.timeout(90000),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const result = { status: response.status, body: parsed, text, headers: response.headers, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
    trace.push({ path: target.pathname + target.search, method, body, status: result.status, response: parsed ?? text, headers: Object.fromEntries(response.headers) });
    return result;
  };
  const mcp = async (token, name, args = {}) => {
    const id = ++requestId;
    const response = await request('/api/mcp', { token, method: 'POST', headers: { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' }, body: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } } });
    let raw = response.body;
    if (!raw) {
      const lines = response.text.split('\n').filter(line => line.startsWith('data: '));
      for (const line of lines) { try { const value = JSON.parse(line.slice(6)); if (value.id === id) raw = value; } catch {} }
    }
    if (!raw) throw new Error(`MCP ${name}: HTTP ${response.status}: ${response.text.slice(0, 500)}`);
    const result = raw.result ?? raw;
    const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') ?? raw.error?.message ?? '';
    let value = result.structuredContent ?? null;
    try { value ??= JSON.parse(text); } catch {}
    return { raw: result, text, value, isError: Boolean(result.isError || raw.error || response.status >= 400) };
  };
  const bootstrap = async (email, extra = {}) => {
    const response = await request('/api/agents/bootstrap', { body: { email, agentName: 'Claude Code', machine: `Fixture ${name}`, ...extra } });
    if (response.status !== 200) throw new Error(`Bootstrap HTTP ${response.status}: ${response.text}`);
    return response.body;
  };
  return {
    ...runtime, name, directory, evidenceDir: directory, artifact, request, mcp, bootstrap,
    get events() { return runtime.events.slice(startIndex); },
    get sinkEvents() { return runtime.events.slice(startIndex); },
    outputs,
    output: (text, surface = 'output') => { outputs.push({ text, surface }); },
    cleanup: callback => cleanups.push(callback),
    resetRateLimits: async () => { await runtime.sql`DELETE FROM rate_limits`; await runtime.sql`DELETE FROM auth_rate_limit`; },
    finish() {
      finished ??= (async () => {
      const failures = [];
      for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch (error) { failures.push(error); } }
      const counts = {};
      for (const table of ['members', 'teams', 'hive_memberships', 'agent_credentials', 'learnings', 'learning_shares', 'project_sharing_grants', 'hive_join_requests', 'feedback']) {
        counts[table] = Number((await runtime.sql.unsafe(`SELECT count(*) AS count FROM "${table}"`))[0].count);
      }
      await artifact('http.json', trace);
      await artifact('mail.json', runtime.events.slice(startIndex).filter(event => event.kind === 'mail'));
      await artifact('slack.json', runtime.events.slice(startIndex).filter(event => event.kind === 'slack'));
      await artifact('models.json', runtime.events.slice(startIndex).filter(event => event.kind === 'model'));
      await artifact('events.json', runtime.events.slice(startIndex));
      await artifact('db-counts.json', counts);
      await artifact('outputs.json', outputs);
      if (failures.length) throw new AggregateError(failures, 'Scenario cleanup failed');
      })();
      return finished;
    },
  };
}
