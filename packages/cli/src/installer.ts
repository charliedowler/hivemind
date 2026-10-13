import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync, openSync, closeSync, copyFileSync, renameSync, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export type Agent = 'claude' | 'codex';
type Hook = { type?: string; command?: string; [key: string]: unknown };
type HookGroup = { hooks: Hook[]; [key: string]: unknown };
type OwnedHook = { event: string; command: string; group?: HookGroup };
type Settings = { hooks?: Record<string, HookGroup[]>; [key: string]: unknown };
type OwnedFile = { hash: string; previous?: string };
type Manifest = { version: 1; agents: Agent[]; files: Record<string, OwnedFile>; registered: Agent[]; backupDirectories: string[]; ownedHooks: OwnedHook[] };
export type Result = { status: number; stdout: string; stderr: string };
export type Runner = (command: string, args: string[], home: string) => Result;
export type Options = { home: string; agents?: Agent[]; backupDir?: string; run?: Runner; log?: (line: string) => void; assets?: string; registerMcp?: boolean; onDoctor?: (agent: Agent, healthy: boolean) => void };
export const url = 'https://gohive.dev/api/mcp';
export const startMarker = '<!-- hive:start -->';
export const endMarker = '<!-- hive:end -->';
const assetDirectory = fileURLToPath(new URL('../assets/hive/', import.meta.url));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : undefined;
const manifestPath = (home: string) => join(home, '.hive/install.json');
const instructionPaths = (home: string, agent: Agent) => join(home, agent === 'claude' ? '.claude/CLAUDE.md' : '.codex/AGENTS.md');
const hookCommand = (home: string, script: string) => `node "${join(home, '.claude/skills/hive/scripts', script).replace(/(["\\$`])/g, '\\$1')}"`;

export const runCommand: Runner = (command, args, home) => {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, HIVE_HOME: home, CODEX_HOME: join(home, '.codex') };
  delete env.CLAUDE_CONFIG_DIR;
  const result = spawnSync(command, args, { encoding: 'utf8', env, cwd: home, timeout: 15000, maxBuffer: 2_000_000 });
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || result.error?.message || '' };
};

export function validateSettings(value: unknown): asserts value is Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Claude settings must contain a JSON object');
  const hooks = (value as Settings).hooks;
  if (hooks !== undefined && (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))) throw new Error('Claude hooks must contain a JSON object');
  for (const groups of Object.values(hooks || {})) {
    if (!Array.isArray(groups) || groups.some(group => !group || typeof group !== 'object' || !Array.isArray(group.hooks) || group.hooks.some(hook => !hook || typeof hook !== 'object' || Array.isArray(hook)))) throw new Error('Claude hook entries are malformed. No files were changed');
  }
}

export function mergeHooks(value: unknown, home: string, remove = false, ownedHooks?: OwnedHook[]): Settings {
  validateSettings(value);
  const settings: Settings = structuredClone(value);
  const hooks = settings.hooks || {};
  for (const [event, script] of [['SessionStart', 'session-start.mjs'], ['Stop', 'stop.mjs']]) {
    const command = hookCommand(home, script);
    const groups = hooks[event] || [];
    if (remove) {
      if (ownedHooks) {
        const records = ownedHooks.filter(hook => hook.event === event && hook.command === command);
        const remaining = [...groups];
        for (const record of records) {
          if (!record.group) continue;
          const index = remaining.findIndex(group => isDeepStrictEqual(group, record.group));
          if (index !== -1) remaining.splice(index, 1);
        }
        if (remaining.length) hooks[event] = remaining;
        else delete hooks[event];
        continue;
      }
      const kept = groups.flatMap(group => {
        const remaining = group.hooks.filter(hook => !(hook.type === 'command' && hook.command === command));
        return remaining.length ? [{ ...group, hooks: remaining }] : [];
      });
      if (kept.length) hooks[event] = kept;
      else delete hooks[event];
    } else if (!groups.some(group => group.hooks.some(hook => hook.type === 'command' && hook.command === command))) {
      hooks[event] = [...groups, { ...(event === 'SessionStart' ? { matcher: 'startup|resume|clear|compact' } : {}), hooks: [{ type: 'command', command, timeout: event === 'SessionStart' ? 4 : 6 }] }];
    }
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  return settings;
}

export function markInstructions(text: string, agent: Agent, remove = false): string {
  const begin = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if ((begin === -1) !== (end === -1) || (begin !== -1 && (end < begin || text.indexOf(startMarker, begin + 1) !== -1 || text.indexOf(endMarker, end + 1) !== -1))) throw new Error('The Hive instruction markers are incomplete or duplicated. No files were changed');
  const skill = agent === 'claude' ? '~/.claude/skills/hive/SKILL.md' : '~/.agents/skills/hive/SKILL.md (also ~/.codex/skills/hive/SKILL.md)';
  const block = `${startMarker}\n## Hive team memory\nRead ${skill} when starting repo work, investigating an unfamiliar error, choosing an approach, or answering how this repo works. Call hive_search before investigating. Before finishing, save scrubbed, verified fixes, gotchas, decisions, insights and friction with hive_push; use supersedes to replace stale cells. Skip routine summaries and sensitive data.\n${endMarker}`;
  if (begin !== -1) {
    const after = end + endMarker.length;
    return remove ? text.slice(0, begin) + text.slice(after).replace(/^\r?\n/, '') : text.slice(0, begin) + block + text.slice(after);
  }
  return remove ? text : text + (text && !text.endsWith('\n') ? '\n' : '') + block + '\n';
}

function atomicWrite(path: string, content: string | Buffer) {
  const target = existsSync(path) && lstatSync(path).isSymbolicLink() ? realpathSync(path) : path;
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, target);
}

function loadManifest(home: string): Manifest {
  const content = read(manifestPath(home));
  if (!content) return { version: 1, agents: [], files: {}, registered: [], backupDirectories: [], ownedHooks: [] };
  const manifest = JSON.parse(content) as Manifest;
  if (manifest.version !== 1 || !manifest.files || !Array.isArray(manifest.agents) || !Array.isArray(manifest.registered)) throw new Error('The Hive install record is not supported');
  if (!manifest.ownedHooks) {
    const originalPath = manifest.backupDirectories?.[0] ? join(manifest.backupDirectories[0], '.claude/settings.json') : undefined;
    const original: Settings = JSON.parse(originalPath ? read(originalPath) || '{}' : '{}');
    manifest.ownedHooks = manifest.agents.includes('claude') ? [['SessionStart', 'session-start.mjs'], ['Stop', 'stop.mjs']].filter(([event, script]) => !(original.hooks?.[event] || []).some(group => group.hooks.some(hook => hook.command === hookCommand(home, script)))).map(([event, script]) => ({ event, command: hookCommand(home, script), group: { ...(event === 'SessionStart' ? { matcher: 'startup|resume|clear|compact' } : {}), hooks: [{ type: 'command', command: hookCommand(home, script), timeout: event === 'SessionStart' ? 4 : 6 }] } })) : [];
  }
  for (const record of manifest.ownedHooks) {
    if (!record.group) record.group = { ...(record.event === 'SessionStart' ? { matcher: 'startup|resume|clear|compact' } : {}), hooks: [{ type: 'command', command: record.command, timeout: record.event === 'SessionStart' ? 4 : 6 }] };
  }
  return manifest;
}

function withLock<T>(home: string, work: () => T): T {
  mkdirSync(join(home, '.hive'), { recursive: true, mode: 0o700 });
  const lockPath = join(home, '.hive/install.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); } catch { throw new Error('Another Hive install is running. Retry when it finishes'); }
  try { return work(); } finally { closeSync(lock); unlinkSync(lockPath); }
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function backUp(home: string, paths: string[], directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const target = join(directory, relative(home, path));
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(path, target);
    chmodSync(target, 0o600);
  }
}

function server(home: string, agent: Agent, run: Runner): { exists: boolean; compatible: boolean } {
  if (agent === 'claude') {
    const config = JSON.parse(read(join(home, '.claude.json')) || '{}');
    const hive = config.mcpServers?.hive;
    return { exists: !!hive, compatible: hive?.type === 'http' && hive?.url?.replace(/\/$/, '') === url };
  }
  const result = run('codex', ['mcp', 'get', 'hive', '--json'], home);
  if (result.status !== 0) {
    if (!/not found|no mcp server|does not exist|unknown server/i.test(result.stderr + result.stdout)) throw new Error('Codex could not inspect the existing Hive server. No files were changed');
    return { exists: false, compatible: false };
  }
  const value = JSON.parse(result.stdout);
  return { exists: true, compatible: value.transport?.url?.replace(/\/$/, '') === url };
}

export function detectAgents(home: string, run: Runner = runCommand): Agent[] {
  return (['claude', 'codex'] as Agent[]).filter(agent => run(agent, ['--version'], home).status === 0);
}

export function install(options: Options): Manifest {
  const home = resolve(options.home);
  const run = options.run || runCommand;
  const log = options.log || console.log;
  return withLock(home, () => {
    const manifest = loadManifest(home);
    const agents = options.agents || detectAgents(home, run);
    if (!agents.length) throw new Error('No forager found. Install Claude Code or Codex, then try again');
    const writes = new Map<string, string | Buffer>();
    const settingsPath = join(home, '.claude/settings.json');
    for (const agent of agents) {
      const path = instructionPaths(home, agent);
      writes.set(path, markInstructions(read(path) || '', agent));
      const destinations = agent === 'claude' ? ['.claude/skills/hive'] : ['.agents/skills/hive', '.codex/skills/hive'];
      for (const destination of destinations) {
        for (const source of filesUnder(options.assets || assetDirectory)) {
          const target = join(home, destination, relative(options.assets || assetDirectory, source));
          const current = read(target);
          const owned = manifest.files[relative(home, target)];
          if (current !== undefined && (!owned || digest(current) !== owned.hash)) throw new Error(`The skill at ${target} has local changes. No files were changed`);
          writes.set(target, readFileSync(source));
        }
      }
    }
    if (agents.includes('claude')) {
      const existing = JSON.parse(read(settingsPath) || '{}') as Settings;
      const merged = mergeHooks(existing, home);
      for (const [event, script] of [['SessionStart', 'session-start.mjs'], ['Stop', 'stop.mjs']]) {
        const command = hookCommand(home, script);
        if (!(existing.hooks?.[event] || []).some(group => group.hooks.some(hook => hook.type === 'command' && hook.command === command))) manifest.ownedHooks.push({ event, command, group: structuredClone(merged.hooks![event].at(-1)!) });
      }
      writes.set(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    }
    const servers = options.registerMcp === false ? new Map<Agent, { exists: boolean; compatible: boolean }>() : new Map(agents.map(agent => [agent, server(home, agent, run)]));
    for (const [agent, value] of servers) if (value.exists && !value.compatible) throw new Error(`${agent} already has a different server called hive. No files were changed`);
    const backupDir = options.backupDir || join(home, '.hive/backups', `${Date.now()}-${randomUUID().slice(0, 8)}`);
    const configurationPaths = [join(home, '.claude.json'), join(home, '.claude/settings.json'), join(home, '.claude/CLAUDE.md'), join(home, '.codex/config.toml'), join(home, '.codex/AGENTS.md'), manifestPath(home)];
    backUp(home, [...configurationPaths, ...writes.keys()], backupDir);
    log(`Your old files are safe in ${backupDir}`);
    manifest.backupDirectories.push(backupDir);
    manifest.agents = [...new Set([...manifest.agents, ...agents])];
    for (const [path, content] of writes) {
      const before = read(path);
      if (before === content || (Buffer.isBuffer(content) && before === content.toString('utf8'))) continue;
      atomicWrite(path, content);
      if (path.includes('/skills/hive/')) manifest.files[relative(home, path)] = { hash: digest(content), ...(manifest.files[relative(home, path)]?.previous ? { previous: manifest.files[relative(home, path)].previous } : {}) };
    }
    try {
      for (const [agent, value] of servers) {
        if (value.exists) { log(`${agent === 'claude' ? 'Claude Code' : 'Codex'} already knows this hive`); continue; }
        const args = agent === 'claude' ? ['mcp', 'add', '--transport', 'http', 'hive', url, '--scope', 'user'] : ['mcp', 'add', 'hive', '--url', url];
        const result = run(agent, args, home);
        if (result.status !== 0) throw new Error(`${agent} could not register Hive. Check the agent CLI, then run gohive install again`);
        manifest.registered = [...new Set([...manifest.registered, agent])];
        atomicWrite(manifestPath(home), JSON.stringify(manifest, null, 2) + '\n');
        log(`${agent === 'claude' ? 'Claude Code' : 'Codex'} has joined the hive`);
      }
    } catch (error) {
      log('The install did not finish. Backups and the install record are saved for a retry');
      atomicWrite(manifestPath(home), JSON.stringify(manifest, null, 2) + '\n');
      throw error;
    }
    manifest.agents = [...new Set([...manifest.agents, ...agents])];
    atomicWrite(manifestPath(home), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  });
}

export function connectionHealthy(options: Options, client: Agent | 'hooks'): boolean {
  const run = options.run || runCommand;
  try {
    if (client === 'claude') {
      const result = run('claude', ['mcp', 'list'], options.home);
      const line = result.stdout.split('\n').find(line => /^hive(?:\s|:)/i.test(line.trim()));
      return result.status === 0 && !!line && /connected/i.test(line) && !/not connected|disconnected/i.test(line);
    }
    return run(process.execPath, [join(options.assets || assetDirectory, 'scripts/doctor.mjs'), client === 'codex' ? '--codex' : '--hooks'], options.home).status === 0;
  } catch { return false; }
}

export type SignInRunner = (client: 'codex' | 'hooks', home: string, script: string) => number;
export function completeSignIn(options: Options, interactive: boolean, signIn: SignInRunner) {
  const agents = options.agents || detectAgents(options.home, options.run);
  const log = options.log || console.log;
  if (!interactive) return;
  for (const agent of agents) {
    if (agent !== 'codex' || connectionHealthy(options, agent)) continue;
    log('Codex: Opening sign-in');
    try { signIn('codex', options.home, ''); } catch {}
  }
  if (agents.includes('claude') && !connectionHealthy(options, 'hooks')) {
    log('Hooks: Opening sign-in');
    try { signIn('hooks', options.home, join(options.home, '.claude/skills/hive/scripts/login.mjs')); } catch {}
  }
}

export function doctor(options: Options): boolean {
  const home = resolve(options.home);
  const log = options.log || console.log;
  const agents = options.agents || detectAgents(home, options.run);
  if (!agents.length) { log('No agent found. Install Claude Code or Codex'); return false; }
  let healthy = true;
  for (const agent of agents) {
    const directories = agent === 'claude' ? ['.claude/skills/hive'] : ['.agents/skills/hive', '.codex/skills/hive'];
    const requiredFiles = filesUnder(options.assets || assetDirectory).map(path => relative(options.assets || assetDirectory, path));
    const skills = directories.every(directory => requiredFiles.every(path => existsSync(join(home, directory, path))));
    const text = read(instructionPaths(home, agent)) || '';
    const instructions = text.includes(startMarker) && text.includes(endMarker);
    let hooks = true;
    if (agent === 'claude') {
      try {
        const settings: Settings = JSON.parse(read(join(home, '.claude/settings.json')) || '{}');
        validateSettings(settings);
        hooks = [['SessionStart', 'session-start.mjs'], ['Stop', 'stop.mjs']].every(([event, script]) =>
          (settings.hooks?.[event] || []).some(group => group.hooks.some(hook => hook.command === hookCommand(home, script))) && existsSync(join(home, '.claude/skills/hive/scripts', script)));
      } catch { hooks = false; }
    }
    const installed = skills && instructions && hooks;
    const connected = connectionHealthy({ ...options, home }, agent);
    const hookConnected = agent !== 'claude' || connectionHealthy({ ...options, home }, 'hooks');
    const ready = installed && connected && hookConnected;
    const step = !installed ? `Run npx gohive install --client ${agent}`
      : !connected ? agent === 'codex' ? 'Run codex mcp login hive' : 'Open Claude Code, then use /mcp to sign in to hive'
      : 'Run npx gohive login';
    log(`${agent === 'claude' ? 'Claude Code' : 'Codex'}: ${ready ? 'Connected' : !installed ? 'Setup incomplete' : !connected ? 'Sign-in or connection check needed' : 'Hook sign-in needed'}${ready ? '' : `. ${step}`}`);
    healthy &&= ready;
    options.onDoctor?.(agent, ready);
  }
  return healthy;
}

export function uninstall(options: Options) {
  const home = resolve(options.home);
  const run = options.run || runCommand;
  const log = options.log || console.log;
  return withLock(home, () => {
    if (!existsSync(manifestPath(home))) { log('Hive has no install record here. Nothing changed'); return; }
    const manifest = loadManifest(home);
    for (const path of Object.keys(manifest.files)) {
      const full = resolve(home, path);
      if (!['.claude/skills/hive/', '.codex/skills/hive/', '.agents/skills/hive/'].some(prefix => path.startsWith(prefix)) || !full.startsWith(home + '/') || relative(home, full) !== path) throw new Error('The Hive install record contains an unexpected path');
    }
    const writes = new Map<string, string>();
    for (const agent of manifest.agents) {
      const path = instructionPaths(home, agent);
      const text = read(path);
      if (text !== undefined) writes.set(path, markInstructions(text, agent, true));
    }
    const settingsPath = join(home, '.claude/settings.json');
    if (manifest.agents.includes('claude') && existsSync(settingsPath)) writes.set(settingsPath, JSON.stringify(mergeHooks(JSON.parse(read(settingsPath)!), home, true, manifest.ownedHooks), null, 2) + '\n');
    const backupDir = options.backupDir || join(home, '.hive/backups', `${Date.now()}-uninstall`);
    backUp(home, [...writes.keys(), join(home, '.claude.json'), join(home, '.codex/config.toml'), manifestPath(home)], backupDir);
    for (const [path, content] of writes) atomicWrite(path, content);
    const remainingHooks: Settings = manifest.agents.includes('claude') ? JSON.parse(read(settingsPath) || '{}') : {};
    const retainedRuntime = Object.values(remainingHooks.hooks || {}).some(groups => groups.some(group => group.hooks.some(hook => typeof hook.command === 'string' && hook.command.includes(join(home, '.claude/skills/hive/scripts')))));
    manifest.ownedHooks = [];
    atomicWrite(manifestPath(home), JSON.stringify(manifest, null, 2) + '\n');
    if (retainedRuntime) log('Kept the Claude skill runtime for a preserved hook');
    for (const [path, owned] of Object.entries(manifest.files)) {
      const full = resolve(home, path);
      if (!['.claude/skills/hive/', '.codex/skills/hive/', '.agents/skills/hive/'].some(prefix => path.startsWith(prefix)) || !full.startsWith(home + '/') || relative(home, full) !== path) throw new Error('The Hive install record contains an unexpected path');
      if (retainedRuntime && path.startsWith('.claude/skills/hive/')) continue;
      const current = read(full);
      if (current === undefined) continue;
      if (digest(current) !== owned.hash) { log(`Kept a changed skill file: ${full}`); continue; }
      unlinkSync(full);
    }
    const remaining: Agent[] = [];
    for (const agent of manifest.registered) {
      const value = server(home, agent, run);
      if (!value.exists) continue;
      if (!value.compatible) { log(`Kept the changed ${agent} MCP server`); continue; }
      const args = agent === 'claude' ? ['mcp', 'remove', 'hive', '--scope', 'user'] : ['mcp', 'remove', 'hive'];
      if (run(agent, args, home).status !== 0) { remaining.push(agent); log(`Could not remove the ${agent} Hive server. Retry gohive uninstall`); }
    }
    if (remaining.length) atomicWrite(manifestPath(home), JSON.stringify({ ...manifest, registered: remaining }, null, 2) + '\n');
    else unlinkSync(manifestPath(home));
    if (remaining.length) throw new Error('Hive removal needs another pass. Your backups and install record are saved');
    log(`Hive is uninstalled. Your other hooks and servers are still there. Backups are in ${backupDir}`);
  });
}
