import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { appendFileSync, constants, existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const fixtures = fileURLToPath(new URL('../fixtures/bin/', import.meta.url));
const active = new Set();
let handlersInstalled = false;

export function localUrl(value) {
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Harness requires a loopback Hive URL');
  assert.equal(url.protocol, 'http:');
  assert.equal(url.username + url.password, '');
  return url.origin;
}

export function scrubEnvironment(source = process.env) {
  const keys = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'TZ', 'SystemRoot', 'WINDIR'];
  return Object.fromEntries(keys.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
}

export function redactEvidence(value, secrets = []) {
  const clean = text => secrets.filter(secret => typeof secret === 'string' && secret.length > 7).reduce((result, secret) => result.replaceAll(secret, '[REDACTED]'), text)
    .replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-ant-|sk-proj-|sk_live_)[A-Za-z0-9_-]+/g, '[REDACTED]');
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(item => redactEvidence(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:authorization|cookie|access_?token|refresh_?token|id_?token|api_?key|credential|pollingToken)$/i.test(key) ? '[REDACTED]' : redactEvidence(item, secrets)]));
  return value;
}

export async function resolveExecutable(name, path = process.env.PATH || '') {
  for (const directory of path.split(delimiter)) {
    const candidate = resolve(directory, name);
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch {}
  }
  throw new Error(`Required executable is unavailable: ${name}`);
}

function killGroup(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

function registerCleanup(machine) {
  active.add(machine);
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.once('exit', () => { for (const item of active) item.cleanupSync(); });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { for (const item of active) item.cleanupSync(); });
}

export async function createMachine(options = {}) {
  const url = localUrl(options.url);
  const client = options.client || 'claude';
  const mode = options.mode || 'fake';
  assert.ok(['claude', 'codex'].includes(client));
  assert.ok(['fake', 'real'].includes(mode));
  options.signal?.throwIfAborted();
  const repoRoot = options.repoRoot || repository;
  const realHome = homedir();
  const originalPath = process.env.PATH || '';
  const executables = { node: process.execPath, git: await resolveExecutable('git', originalPath) };
  if (mode === 'real') executables[client] = await resolveExecutable(client, originalPath);
  await mkdir('/tmp/hive-e2e', { recursive: true, mode: 0o700 });
  const root = await mkdtemp('/tmp/hive-e2e/machine-');
  await chmod(root, 0o700);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  const bin = join(root, 'bin');
  const log = join(root, 'calls.jsonl');
  const children = new Set();
  const secrets = [];
  let closed = false;
  const machine = {
    root, home, cwd, client, mode, url, executables, options, email: options.email || `machine-${randomUUID().slice(0, 8)}@example.com`,
    paths: { bin, log, installer: join(repoRoot, 'packages/cli/dist/bin.js'), codex: join(home, '.codex'), claude: join(home, '.claude') },
    env: {},
    redact: value => redactEvidence(value, secrets),
    rememberSecret(value) { if (typeof value === 'string') secrets.push(value); },
    async read(path) { return readFile(machine.path(path), 'utf8'); },
    path(path) {
      const target = resolve(home, path);
      assert.ok(target.startsWith(home + sep), 'Machine path must stay inside its scratch HOME');
      return target;
    },
    async write(path, value) {
      const target = machine.path(path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
      await chmod(target, 0o600);
      return target;
    },
    async calls() { return (existsSync(log) ? await readFile(log, 'utf8') : '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); },
    async prepareSandbox() {
      if (machine.sandbox) return machine.sandbox;
      assert.equal(process.platform, 'darwin', 'Real runs require the macOS OS sandbox; this host needs an equivalent sandbox adapter');
      await access('/usr/bin/sandbox-exec', constants.X_OK);
      const hosts = client === 'claude' ? ['api.anthropic.com', 'claude.ai', 'platform.claude.com', 'console.anthropic.com'] : ['api.openai.com', 'chatgpt.com', 'auth.openai.com'];
      const sockets = new Set();
      const proxy = createServer((_request, response) => { response.writeHead(403); response.end('Only provider TLS CONNECT is allowed'); });
      proxy.on('connect', (request, socket, head) => {
        let target;
        try { target = new URL(`https://${request.url}`); } catch { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
        if (!hosts.includes(target.hostname) || (target.port && target.port !== '443')) {
          appendFileSync(log, JSON.stringify({ kind: 'network-rejected', host: target.hostname }) + '\n', { mode: 0o600 });
          socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
          return;
        }
        appendFileSync(log, JSON.stringify({ kind: 'provider-connect', host: target.hostname }) + '\n', { mode: 0o600 });
        const remote = connect(443, target.hostname);
        for (const item of [socket, remote]) { sockets.add(item); item.on('close', () => sockets.delete(item)); }
        remote.on('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); socket.pipe(remote); remote.pipe(socket); });
        remote.on('error', () => socket.destroy());
        socket.on('error', () => remote.destroy());
      });
      await new Promise((resolveProxy, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolveProxy); });
      machine.proxy = { server: proxy, sockets };
      const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
      Object.assign(machine.env, { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl, NO_PROXY: 'localhost,127.0.0.1,::1' });
      const canonicalRoot = await realpath(root);
      const readable = [canonicalRoot, root, dirname(executables[client]), dirname(executables.node), resolve(dirname(executables.node), '../lib/node_modules/npm'), join(repoRoot, 'packages/cli'), fixtures];
      if (client === 'codex') readable.push(resolve(dirname(executables.codex), '../..'));
      const quote = JSON.stringify;
      const profile = [
        '(version 1)', '(allow default)',
        `(deny file-read* (subpath ${quote(realHome)}) (subpath "/private/tmp") (subpath "/tmp"))`,
        '(allow file-read-metadata)',
        `(allow file-read* ${readable.map(path => `(subpath ${quote(path)})`).join(' ')})`,
        '(deny file-write*)',
        `(allow file-write* (subpath ${quote(canonicalRoot)}) (subpath ${quote(root)}) (literal "/dev/null") (literal "/dev/tty"))`,
        '(deny network-outbound)', '(allow network-outbound (remote ip "localhost:*"))',
      ].join('\n');
      const file = join(root, 'agent.sb');
      await writeFile(file, profile, { mode: 0o600 });
      machine.sandbox = { executable: '/usr/bin/sandbox-exec', file, providerHosts: hosts, proxyUrl };
      return machine.sandbox;
    },
    async exec(file, args = [], execution = {}) {
      assert.ok(!closed, 'Machine is already cleaned up');
      const signal = execution.signal || options.signal;
      signal?.throwIfAborted();
      const env = { ...machine.env, ...execution.env };
      for (const key of Object.keys(env)) {
        assert.ok(!/^(?:ANTHROPIC_|OPENAI_|AZURE_|AWS_|GOOGLE_|GEMINI_|VERTEX_|BEDROCK_|CLAUDE_CODE_OAUTH_TOKEN)/.test(key), `Provider environment variable is forbidden: ${key}`);
      }
      const startedAt = Date.now();
      return new Promise((resolveRun, reject) => {
        if (execution.sandbox) assert.ok(machine.sandbox, 'Prepare the OS sandbox before a real agent run');
        const child = spawn(execution.sandbox ? machine.sandbox.executable : file, execution.sandbox ? ['-f', machine.sandbox.file, file, ...args] : args, { cwd: execution.cwd || cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        children.add(child);
        let stdout = '', stderr = '', failure;
        const stop = error => { failure ||= error; killGroup(child.pid); };
        const aborted = () => stop(signal.reason || new Error('Machine execution aborted'));
        const timer = setTimeout(() => stop(new Error(`Child exceeded ${execution.timeoutMs || 30000} ms`)), execution.timeoutMs || 30000);
        signal?.addEventListener('abort', aborted, { once: true });
        child.stdout.on('data', chunk => {
          stdout += chunk;
          if (stdout.length + stderr.length > (execution.maxBytes || 12000000)) stop(new Error('Child output limit exceeded'));
          try { execution.onStdout?.(chunk.toString(), child); } catch (error) { stop(error); }
        });
        child.stderr.on('data', chunk => { stderr += chunk; if (stdout.length + stderr.length > (execution.maxBytes || 12000000)) stop(new Error('Child output limit exceeded')); });
        child.on('error', error => { failure = error; });
        child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
        child.on('close', (status, childSignal) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', aborted);
          children.delete(child);
          const result = { status, signal: childSignal, stdout, stderr, durationMs: Date.now() - startedAt };
          if (failure) { failure.result = execution.sensitiveOutput ? { status, signal: childSignal, durationMs: result.durationMs } : machine.redact(result); reject(failure); }
          else resolveRun(result);
        });
        child.stdin.end(execution.input || '');
      });
    },
    async installerVersion() {
      const metadata = JSON.parse(await readFile(join(repoRoot, 'packages/cli/package.json'), 'utf8'));
      return metadata.version;
    },
    async assertLocalInstaller() {
      if (!(await machine.installerVersion()).startsWith('0.1.')) return;
      const probe = await machine.exec(executables.node, ['--input-type=module', '-e', `const module = await import(${JSON.stringify(join(repoRoot, 'packages/cli/dist/installer.js'))}); process.stdout.write(String(module.url));`]);
      assert.equal(probe.status, 0, `Installer URL probe failed: ${machine.redact(probe.stderr)}`);
      assert.equal(probe.stdout, `${url}/api/mcp`, 'Installer ignores HIVE_URL and would register a production MCP endpoint (packages/cli/src/installer.ts:18)');
    },
    async install({ client: selected, marker = client, signIn = false, onAuth = options.onInstallerAuth, args = [] } = {}) {
      if ((mode === 'real' || signIn) && !options.localConfigOverride) await machine.assertLocalInstaller();
      if (mode === 'real') await machine.prepareSandbox();
      const env = { CLAUDECODE: marker === 'claude' ? '1' : '', CODEX_THREAD_ID: marker === 'codex' ? 'e2e-fixture' : '' };
      const legacy = (await machine.installerVersion()).startsWith('0.1.');
      const result = await machine.exec(executables.node, [machine.paths.installer, 'install', ...(selected ? ['--client', selected] : []), ...(legacy ? (!signIn ? ['--yes'] : []) : ['--email', machine.email]), ...args], { env, sandbox: mode === 'real' });
      if (result.status === 0) await machine.syncNativeConfig();
      if (signIn && result.status === 0) {
        assert.equal(typeof onAuth, 'function', 'Local installer sign-in needs an onInstallerAuth callback');
        await onAuth(machine, { protocol: (await machine.installerVersion()).startsWith('0.1.') ? 'oauth' : 'bootstrap', signal: options.signal });
      }
      return result;
    },
    async setHiveCredential(token) {
      assert.ok(token, 'A real local Hive credential is required');
      machine.rememberSecret(token);
      await machine.write('.hive/oauth.json', { baseUrl: url, access_token: token, expires_at: Date.now() + 3600000 });
      if (existsSync(machine.path('.hive/agent.json'))) await machine.write('.hive/agent.json', { baseUrl: url, agents: [client], credential: token });
    },
    async syncNativeConfig() {
      if (mode !== 'real' || client !== 'claude' || !existsSync(machine.path('.claude.json'))) return;
      await machine.write('.claude/.claude.json', await machine.read('.claude.json'));
      await options.onEvent?.({ kind: 'setup-deviation', detail: 'Copied scratch installer MCP config into CLAUDE_CONFIG_DIR so native Claude uses its isolated credential namespace. No real config was read or changed.' });
    },
    async configureNativeBearer(token) {
      await machine.setHiveCredential(token);
      if (client === 'claude') {
        const config = JSON.parse(await machine.read('.claude.json').catch(() => '{}'));
        config.mcpServers ||= {};
        config.mcpServers.hive = { type: 'http', url: `${url}/api/mcp`, headers: { Authorization: `Bearer ${token}` } };
        await machine.write('.claude.json', config);
        await machine.syncNativeConfig();
      } else {
        const config = await machine.read('.codex/config.toml');
        await machine.write('.codex/config.toml', config.replace(/\n?\[mcp_servers\.hive\][\s\S]*?(?=\n\[|$)/, '') + `\n[mcp_servers.hive]\nurl = ${JSON.stringify(`${url}/api/mcp`)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }\n`);
      }
      await options.onEvent?.({ kind: 'setup-deviation', detail: 'A real local bootstrap credential was installed in scratch native MCP config to isolate hook and capture behaviour from legacy OAuth onboarding.' });
    },
    async hook(event, payload = {}) {
      const settings = JSON.parse(await machine.read('.claude/settings.json'));
      const groups = settings.hooks?.[event];
      assert.ok(groups?.length, `Installed hook missing: ${event}`);
      const input = { cwd, session_id: 'e2e-session', ...payload, hook_event_name: event };
      const results = [];
      for (const group of groups) {
        const subject = event === 'SessionStart' ? (payload.source || 'startup') : payload.tool_name;
        if (group.matcher && !new RegExp(`^(?:${group.matcher})$`).test(subject || '')) continue;
        for (const hook of group.hooks) {
          assert.equal(hook.type, 'command');
          assert.ok(hook.command.includes(join(home, '.claude/skills/hive/scripts/')), 'Hook must execute its installed scratch script');
          const result = await machine.exec('/bin/sh', ['-c', hook.command], { input: JSON.stringify(input), timeoutMs: 20000 });
          results.push({ event, input, ...result });
          await options.onEvent?.(machine.redact({ kind: 'hook', event, input, ...result }));
        }
      }
      assert.ok(results.length, `No installed hook matched ${event}`);
      return { results, stdout: results.map(result => result.stdout).join(''), status: results.find(result => result.status !== 0)?.status || 0 };
    },
    cleanupSync() {
      if (closed) return;
      closed = true;
      for (const child of children) killGroup(child.pid);
      for (const socket of machine.proxy?.sockets || []) socket.destroy();
      machine.proxy?.server.closeAllConnections();
      machine.proxy?.server.close();
      const registry = join(root, 'child-pids.jsonl');
      if (existsSync(registry)) for (const line of readFileSync(registry, 'utf8').split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.root !== root || entry.pid === process.pid) continue;
          const cwd = spawnSync('/usr/sbin/lsof', ['-a', '-p', String(entry.pid), '-d', 'cwd', '-Fn'], { env: scrubEnvironment(), encoding: 'utf8', timeout: 1000 });
          if (cwd.stdout.split('\n').some(path => path.startsWith(`n${root}/`) || path.startsWith(`n/private${root}/`))) killGroup(entry.pid);
        } catch {}
      }
      rmSync(root, { recursive: true, force: true });
      options.signal?.removeEventListener('abort', machine.cleanupSync);
      active.delete(machine);
    },
    async cleanup() { machine.cleanupSync(); },
    async [Symbol.asyncDispose]() { await machine.cleanup(); },
  };
  registerCleanup(machine);
  options.signal?.addEventListener('abort', machine.cleanupSync, { once: true });
  try {
    for (const path of [home, cwd, bin, join(root, 'tmp'), join(home, '.claude'), join(home, '.codex'), join(home, '.config'), join(home, '.cache'), join(home, '.local/share')]) await mkdir(path, { recursive: true, mode: 0o700 });
    machine.env = {
      ...scrubEnvironment(), HOME: home, HIVE_HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
      XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'),
      TMPDIR: join(root, 'tmp'), TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'), CLAUDE_CODE_TMPDIR: join(root, 'tmp'), CLAUDE_TMPDIR: join(root, 'tmp'), ZDOTDIR: home, SHELL: '/bin/sh',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), HIVE_URL: url, HIVE_NO_BROWSER: '1',
      HIVE_E2E_ROOT: root, HIVE_E2E_LOG: log, HIVE_E2E_INSTALLER: machine.paths.installer, HIVE_E2E_MODE: mode,
      HIVE_E2E_REAL_CLIENT: client, HIVE_E2E_REAL_EXECUTABLE: executables[client] || '', HIVE_E2E_LOCAL_CONFIG_OVERRIDE: options.localConfigOverride ? '1' : '',
      HIVE_E2E_NODE: executables.node, PATH: [bin, dirname(executables.node), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
      NODE_OPTIONS: `--import=${join(fixtures, 'network-guard.mjs')}`, DISABLE_AUTOUPDATER: '1',
    };
    for (const name of ['claude', 'codex', 'npx', 'gohive', 'open', 'xdg-open', 'curl']) {
      await writeFile(join(bin, name), `#!/bin/sh\nexec '${executables.node.replaceAll("'", "'\\''")}' '${join(fixtures, 'cli.mjs').replaceAll("'", "'\\''")}' '${name}' "$@"\n`, { mode: 0o700 });
    }
    const initialized = await machine.exec(executables.git, ['init', '--quiet', cwd]);
    assert.equal(initialized.status, 0, initialized.stderr);
    for (const args of [['remote', 'add', 'origin', 'https://example.com/fixture/widget.git'], ['config', 'user.name', 'Fixture Developer'], ...(options.email ? [['config', 'user.email', options.email]] : [])]) {
      const result = await machine.exec(executables.git, args);
      assert.equal(result.status, 0, result.stderr);
    }
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node test.mjs' } }), { mode: 0o600 });
    await writeFile(join(cwd, 'test.mjs'), "import { existsSync } from 'node:fs';\nif (!existsSync('fixed.txt')) { console.error('Fixture cache directory is missing'); process.exitCode = 1; } else console.log('1 test passed');\n", { mode: 0o600 });
    if (mode === 'real') await copyAuthentication(machine, options.authSources || {}, realHome);
    options.signal?.throwIfAborted();
    return machine;
  } catch (error) { await machine.cleanup(); throw error; }
}

async function copyAuthentication(machine, sources, realHome) {
  const remember = value => {
    if (Array.isArray(value)) value.forEach(remember);
    else if (value && typeof value === 'object') Object.values(value).forEach(remember);
    else if (typeof value === 'string' && value.length > 16) machine.rememberSecret(value);
  };
  if (machine.client === 'codex') {
    const source = sources.codex || join(realHome, '.codex/auth.json');
    const text = await readFile(source, 'utf8');
    const credentials = JSON.parse(text);
    assert.ok(credentials.tokens?.access_token, 'Codex OAuth auth.json is required; API keys are not used');
    assert.ok(!credentials.OPENAI_API_KEY, 'Codex API-key credentials are forbidden in real e2e');
    remember(credentials);
    await machine.write('.codex/auth.json', text);
    machine.authSource = { client: 'codex', kind: 'copied-file' };
  } else {
    const source = sources.claude || join(realHome, '.claude/.credentials.json');
    let text;
    if (existsSync(source)) {
      text = await readFile(source, 'utf8');
      machine.authSource = { client: 'claude', kind: 'copied-file' };
    } else {
      assert.equal(process.platform, 'darwin', 'Claude OAuth credential file is unavailable');
      const keychain = sources.claudeKeychain || join(realHome, 'Library/Keychains/login.keychain-db');
      const metadata = await machine.exec('/usr/bin/security', ['dump-keychain', keychain], { timeoutMs: 10000, sensitiveOutput: true });
      const services = sources.claudeService ? [sources.claudeService] : [...new Set([...metadata.stdout.matchAll(/"svce"<blob>="(Claude Code-credentials[^"\n]*)"/g)].map(match => match[1]))];
      const candidates = [];
      for (const service of services) {
        const result = await machine.exec('/usr/bin/security', ['find-generic-password', '-s', service, '-w', keychain], { timeoutMs: 10000, sensitiveOutput: true });
        if (result.status !== 0) continue;
        try { const value = JSON.parse(result.stdout); if (value.claudeAiOauth?.accessToken) candidates.push({ text: result.stdout.trim(), expiresAt: value.claudeAiOauth.expiresAt || 0 }); } catch {}
      }
      candidates.sort((a, b) => b.expiresAt - a.expiresAt);
      assert.ok(candidates.length, 'Claude OAuth credentials unavailable in file or macOS keychain');
      text = candidates[0].text;
      machine.authSource = { client: 'claude', kind: 'keychain-copy' };
    }
    const credentials = JSON.parse(text);
    assert.ok(credentials.claudeAiOauth?.accessToken, 'Claude subscription OAuth credentials are required');
    remember(credentials);
    await machine.write('.claude/.credentials.json', text);
  }
}
