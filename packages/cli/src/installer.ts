import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync, openSync, closeSync, copyFileSync, renameSync, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { codexHiveSection, writeCodexServer, writeClaudeServer } from "./agent-config.js";
import { harness } from './identity.js';

export type Agent = 'claude' | 'codex';
type Hook = { type?: string; command?: string; [key: string]: unknown };
type HookGroup = { hooks: Hook[]; [key: string]: unknown };
type OwnedHook = { event: string; command: string; group?: HookGroup };
type Settings = { hooks?: Record<string, HookGroup[]>; [key: string]: unknown };
type OwnedFile = { hash: string; previous?: string };
type Manifest = { executor?: boolean; version: 1; installedVersion?: string; agents: Agent[]; files: Record<string, OwnedFile>; registered: Agent[]; backupDirectories: string[]; ownedHooks: OwnedHook[] };
export type Result = { status: number; stdout: string; stderr: string };
export type Runner = (command: string, args: string[], home: string) => Result;
export type Options = { env?: NodeJS.ProcessEnv; terminalDetection?: boolean; executor?: boolean; home: string; agents?: Agent[]; backupDir?: string; run?: Runner; log?: (line: string) => void; assets?: string; registerMcp?: boolean; onDoctor?: (agent: Agent, healthy: boolean) => void };
export const url = 'https://gohive.dev/api/mcp';
export const startMarker = '<!-- hive:start -->';
export const endMarker = '<!-- hive:end -->';
const assetDirectory = fileURLToPath(new URL('../assets/hive/', import.meta.url));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : undefined;
const manifestPath = (home: string) => join(home, '.hive/install.json');
const instructionPaths = (home: string, agent: Agent | 'executor') => join(home, agent === 'executor' ? '.hive/EXECUTOR.md' : agent === 'claude' ? '.claude/CLAUDE.md' : '.codex/AGENTS.md');
const hookCommand = (home: string, script: string) => `node "${join(home, '.claude/skills/hive/scripts', script).replace(/(["\\$`])/g, '\\$1')}"`;
const hookSpecs = [
  { event: 'SessionStart', script: 'session-start.mjs', matcher: 'startup|resume|clear|compact', timeout: 4, background: false },
  { event: 'Stop', script: 'stop.mjs', timeout: 8, background: false },
  { event: 'PreCompact', script: 'stop.mjs', timeout: 15, background: true },
  { event: 'SubagentStop', script: 'stop.mjs', timeout: 15, background: true },
  { event: 'PostToolUse', script: 'stop.mjs', matcher: 'Bash|mcp__.*__hive_push', timeout: 3, background: false },
  { event: 'PostToolUseFailure', script: 'stop.mjs', matcher: 'Bash', timeout: 3, background: false },
];
const hookGroup = (home: string, spec: typeof hookSpecs[number]): HookGroup => ({ ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [{ type: 'command', command: hookCommand(home, spec.script), timeout: spec.timeout, ...(spec.background ? { async: true } : {}) }] });


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
  for (const spec of hookSpecs) {
    const { event, script } = spec;
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
      hooks[event] = [...groups, hookGroup(home, spec)];
    }
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  return settings;
}

export function markInstructions(text: string, agent: Agent | 'executor', remove = false): string {
  const begin = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if ((begin === -1) !== (end === -1) || (begin !== -1 && (end < begin || text.indexOf(startMarker, begin + 1) !== -1 || text.indexOf(endMarker, end + 1) !== -1))) throw new Error('The Hive instruction markers are incomplete or duplicated. No files were changed');
  const skill = agent === 'executor' ? '~/.hive/skills/hive/SKILL.md' : agent === 'claude' ? '~/.claude/skills/hive/SKILL.md' : '~/.agents/skills/hive/SKILL.md (also ~/.codex/skills/hive/SKILL.md)';
  const executorBlock = `${startMarker}\n## Hive through Executor\nExecutor supplies Hive server instructions and tools after human OAuth. Read ~/.hive/skills/hive/SKILL.md. Discover hive_search through Executor search, describe the full returned path, then call it through call or execute and branch on result.ok. If Hive MCP tools are absent, NEVER run the installer unless the person asked to set up Hive. Ask with the harness's question/picker tool when one exists; otherwise a numbered list. Keep credentials inside Executor's secure connection links. Reuse an existing Hive connection; setup uses npx gohive install --client executor, never email bootstrap. Never ask a setup question you cannot act on yet: until Hive tools answer through Executor, relay only the connection link and stop. Ask the work-areas, exclude or project, and share questions only when the Hive tools are loaded and the answer can be saved with the next tool call; ask each at most once per setup. Hive captures by default from Git repositories with a remote into the personal hive; repos without a remote and home directories capture nothing. Read hive_share_projects; when workAreas is empty, ask once with the picker, Skip or a typed answer: "What kinds of things do you work on that Hive can learn from? Type a few areas, or skip." Save workAreas with humanInstruction at the read revision. Exclude a repo, or save mode selected with include, only when the person asks. Capture on-signal: push a proven fix, decision, gotcha or measured friction immediately through hive_push from allowed repositories, with evidence and consistent runtime context. Keep the Jev gate, skip duplicates and sensitive data. Executor uses no hooks. Joining never publishes; follow the server's sharing instructions. After using a cell, report an evidenced result with hive_outcome and useful, unhelpful or outdated feedback with hive_feedback.\n${endMarker}`;
  const block = agent === 'executor' ? executorBlock : `${startMarker}\n## Hive team memory\nClaude Code checks for updates from its SessionStart hook; never run gohive commands in the chat thread for updates. In Codex, at the first Hive use run node ~/.codex/skills/hive/scripts/auto-update.mjs once; it returns in under a second. Follow any minimum-version update notice; ordinary updates stay silent. Read ${skill} when starting repo work or investigating an unfamiliar error. Call hive_search before investigating. Already installed and signed in means skip installation and account creation. If Hive MCP tools are absent, NEVER run the installer unless the person asked to set up Hive or this is the onboarding prompt. Run npx --yes gohive@latest status once in the background and keep working on the task meanwhile (Claude Code: Bash with run_in_background); never --no-install. If installed and signed in, say exactly one line: "Hive is set up but not loaded in this session; restart Codex (or run /mcp in Claude Code) to use it", then continue without Hive. If not installed, offer setup in one line and do nothing else. Never announce installation outside an actual install. Status prints the organisation invitation link and prompt; do not repeat it to the person unless they asked how to invite teammates. If latest resolves to a missing version, retry once with the version status printed, then give up quietly. For requested setup with Executor tools visible, pass HIVE_EXECUTOR_TOOLS=1. If install returns offer_executor, ask its exact question with Yes / Not now; run install --client executor or install --skip-executor respectively. Read https://gohive.dev/agent for the tools-based fallback. For other setup, run npx --yes gohive@latest install and read its needs_email result. Ask with the harness's question/picker tool when one exists; otherwise a numbered list. Confirm the detected email: Yes / Type a different one. Rerun install --email with the human's answer and --join-url when supplied. Agents use Hive bearer credentials; no browser opens. With a join link, call hive_join; on needs_human say "Open <joinUrl> to join <team>". A pending claim starts private; tell the person to click the email link once. Never ask a setup question you cannot act on yet: after install, if the Hive tools are not loaded in this session, say only the installer's next_steps line ("Two steps left: click the link in your email, then run /mcp in Claude Code (or restart Codex). I'll finish setting up Hive after that.") and stop. Ask the work-areas, exclude or project, and share questions only when the Hive tools are loaded and the answer can be saved with the next tool call; ask each at most once per setup. Hive captures by default from Git repositories with a remote into the personal hive; repos without a remote and home directories capture nothing. Read hive_share_projects; when workAreas is empty, ask once with the picker, Skip or a typed answer: "What kinds of things do you work on that Hive can learn from? Type a few areas, or skip." Save workAreas with humanInstruction at the read revision. Exclude a repo, or save mode selected with include, only when the person asks. Never ask the human to sign up. Joining never publishes. Read hive_agent_status after claim; only when it shows the join completed, ask each share offer's question via the native picker with Yes (Recommended): everything Hive captures for you, now and in future; Choose projects; Not now. Use hive_share_with with mode all_selected for Yes, projects for the chosen projects, or not_now; record the humanInstruction. During setup only, read hive_invite_link and give the team prompt once. Never create, rotate or resume a phrase. Hive saves when something is learned, not when the session ends. Capture a proven fix, decision, gotcha or measured friction immediately with hive_push from allowed repositories only; supply evidence and consistent runtime context, keep the Jev gate, skip duplicates and sensitive data. Stop is a non-blocking safety net. Codex and Executor use the same triggers without hooks. After using a cell, report an evidenced result with hive_outcome. Vote up (useful), down (unhelpful when a cell misled you), or outdated with hive_feedback. Use include_history: true for hidden cells; never vote on cells merely retrieved. Keep the receipt to withdraw current feedback. Organisation feedback never changes the personal original.\n${endMarker}`;
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
    const section = codexHiveSection(read(join(home, '.codex/config.toml')) || '');
    if (section) return { exists: true, compatible: /^url\s*=\s*["']https:\/\/gohive\.dev\/api\/mcp\/?["']/m.test(section) };
    if (!/not found|no mcp server|does not exist|unknown server/i.test(result.stderr + result.stdout)) return { exists: false, compatible: false };
    return { exists: false, compatible: false };
  }
  const value = JSON.parse(result.stdout);
  return { exists: true, compatible: value.transport?.url?.replace(/\/$/, '') === url };
}

export function detectAgents(home: string, run: Runner = runCommand): Agent[] {
  return (['claude', 'codex'] as Agent[]).filter(agent => run(agent, ['--version'], home).status === 0);
}

export function parseClients(value: string): Agent[] {
  const clients = value === 'all' ? ['claude', 'codex'] : value.split(',');
  if (!clients.length || clients.some(client => client !== 'claude' && client !== 'codex')) throw new Error('Choose claude, codex, all, claude,codex or executor for --client');
  return [...new Set(clients)] as Agent[];
}

export function selectAgents(home: string, env: NodeJS.ProcessEnv = process.env, explicit?: Agent[], run: Runner = runCommand): Agent[] {
  if (explicit) return explicit;
  const current = harness(env);
  return current ? [current === 'Claude Code' ? 'claude' : 'codex'] : detectAgents(home, run);
}

export function installedAgents(home: string): Agent[] | undefined {
  return existsSync(manifestPath(home)) ? loadManifest(home).agents : undefined;
}

export function installAnnouncement(agents: Agent[], terminal = false, executor = false): string {
  const names = [...agents.map(agent => agent === 'claude' ? 'Claude Code' : 'Codex'), ...(executor ? ['Executor'] : [])].join(' and ');
  return `Installing Hive for ${names}${terminal ? ' (detected on this machine)' : ''}: the MCP server, a skill${agents.includes('claude') ? ', and capture hooks' : ''} that learn privately from Git repos you work in (exclude any on Account); your config is backed up first.`;
}

export function install(options: Options): Manifest {
  const home = resolve(options.home);
  const run = options.run || runCommand;
  const log = options.log || console.log;
  return withLock(home, () => {
    const manifest = loadManifest(home);
    const agents = selectAgents(home, options.env, options.agents, run);
    if (!agents.length && !options.executor) throw new Error('No forager found. Install Claude Code or Codex, then try again');
    log(installAnnouncement(agents, options.terminalDetection ?? (!options.agents && !harness(options.env || process.env)), options.executor));
    const writes = new Map<string, string | Buffer>();
    const settingsPath = join(home, '.claude/settings.json');
    const instructionAgents: (Agent | 'executor')[] = [...agents, ...(options.executor ? ['executor' as const] : [])];
    for (const agent of instructionAgents) {
      const path = instructionPaths(home, agent);
      writes.set(path, markInstructions(read(path) || '', agent));
      const destinations = agent === 'executor' ? ['.hive/skills/hive'] : agent === 'claude' ? ['.claude/skills/hive'] : ['.agents/skills/hive', '.codex/skills/hive'];
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
      for (const owned of manifest.ownedHooks) {
        const groups = existing.hooks?.[owned.event];
        const index = groups?.findIndex(group => isDeepStrictEqual(group, owned.group)) ?? -1;
        const spec = hookSpecs.find(item => item.event === owned.event);
        if (groups && index >= 0 && spec) { groups[index] = hookGroup(home, spec); owned.group = structuredClone(groups[index]); }
      }
      const merged = mergeHooks(existing, home);
      for (const spec of hookSpecs) {
        const { event, script } = spec;
        const command = hookCommand(home, script);
        if (!(existing.hooks?.[event] || []).some(group => group.hooks.some(hook => hook.type === 'command' && hook.command === command))) manifest.ownedHooks.push({ event, command, group: structuredClone(merged.hooks![event].at(-1)!) });
      }
      writes.set(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    }
    const servers = options.registerMcp === false ? new Map<Agent, { exists: boolean; compatible: boolean }>() : new Map(agents.map(agent => [agent, server(home, agent, run)]));
    for (const [agent, value] of servers) if (value.exists && !value.compatible) throw new Error(`${agent} already has a different server called hive. No files were changed`);
    const backupDir = options.backupDir || join(home, '.hive/backups', `${Date.now()}-${randomUUID().slice(0, 8)}`);
    const configurationPaths = [join(home, '.hive/EXECUTOR.md'), join(home, '.claude.json'), join(home, '.claude/settings.json'), join(home, '.claude/CLAUDE.md'), join(home, '.codex/config.toml'), join(home, '.codex/AGENTS.md'), manifestPath(home)];
    backUp(home, [...configurationPaths, ...writes.keys()], backupDir);
    log(`Your old files are safe in ${backupDir}`);
    manifest.backupDirectories.push(backupDir);
    manifest.agents = [...new Set([...manifest.agents, ...agents])];
    manifest.executor ||= options.executor;
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
        if (result.status !== 0) {
          try {
            if (agent === 'codex') writeCodexServer(home, url);
            else writeClaudeServer(home, url);
            log(`${agent === 'codex' ? 'Codex' : 'Claude Code'}: the native command failed; Hive is registered in its config.`);
          } catch {
            log(`${agent === 'codex' ? 'Codex' : 'Claude Code'} needs attention: its config was kept. The other clients will finish.`);
            continue;
          }
        }
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
    manifest.installedVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
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
  const agents = options.agents || installedAgents(home) || detectAgents(home, options.run);
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
        hooks = hookSpecs.every(({event, script}) =>
          (settings.hooks?.[event] || []).some(group => group.hooks.some(hook => hook.command === hookCommand(home, script))) && existsSync(join(home, '.claude/skills/hive/scripts', script)));
      } catch { hooks = false; }
    }
    const installed = skills && instructions && hooks;
    const connected = connectionHealthy({ ...options, home }, agent);
    const hookConnected = agent !== 'claude' || connectionHealthy({ ...options, home }, 'hooks');
    const ready = installed && connected && hookConnected;
    const step = !installed ? `Run npx gohive@latest install --client ${agent}`
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
      if (!['.claude/skills/hive/', '.codex/skills/hive/', '.agents/skills/hive/', '.hive/skills/hive/'].some(prefix => path.startsWith(prefix)) || !full.startsWith(home + '/') || relative(home, full) !== path) throw new Error('The Hive install record contains an unexpected path');
    }
    const writes = new Map<string, string>();
    for (const agent of [...manifest.agents, ...(manifest.executor ? ['executor' as const] : [])]) {
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
      if (!['.claude/skills/hive/', '.codex/skills/hive/', '.agents/skills/hive/', '.hive/skills/hive/'].some(prefix => path.startsWith(prefix)) || !full.startsWith(home + '/') || relative(home, full) !== path) throw new Error('The Hive install record contains an unexpected path');
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

export function updateInstall(options: Options): Manifest {
  const manifest = loadManifest(options.home);
  if (!manifest.agents.length && !manifest.executor) throw new Error('Hive is not installed. Run npx gohive@latest install');
  const updated = install({ ...options, agents: manifest.agents, executor: manifest.executor, registerMcp: false, terminalDetection: false, log: () => {} });
  const state = join(options.home, '.hive/agent.json');
  const claude = JSON.parse(read(join(options.home, '.claude.json')) || '{}').mcpServers?.hive;
  const codex = codexHiveSection(read(join(options.home, '.codex/config.toml')) || '');
  const oauth = !existsSync(state) && ((manifest.agents.includes('claude') && claude && !claude.headers?.Authorization) || (manifest.agents.includes('codex') && codex !== undefined && !/http_headers|bearer_token_env_var/.test(codex)));
  if (oauth && !existsSync(join(options.home, '.hive/oauth-update-notice.json'))) atomicWrite(join(options.home, '.hive/oauth-update-notice.json'), JSON.stringify({ pending: true }) + '\n');
  return updated;
}
