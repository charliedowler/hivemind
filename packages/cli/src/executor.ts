import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCommand, url, type Runner } from './installer.js';

export type ExecutorOptions = { home: string; endpoint?: string; run?: Runner; log?: (line: string) => void; env?: NodeJS.ProcessEnv; dryRun?: boolean };
export type ExecutorDetection = { detected: boolean; cli: boolean; signals: string[]; version?: string; endpoint?: string };
type ExecutorState = { offered?: boolean; declined?: boolean; setup?: boolean; state?: string };
const statePath = (home: string) => join(home, '.hive/executor.json');
export function executorState(home: string): ExecutorState {
  try { return JSON.parse(readFileSync(statePath(home), 'utf8')); } catch { return {}; }
}
function saveState(home: string, changes: ExecutorState) {
  mkdirSync(join(home, '.hive'), { recursive: true, mode: 0o700 });
  const temp = `${statePath(home)}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...executorState(home), ...changes }) + '\n', { mode: 0o600 });
  renameSync(temp, statePath(home));
}
export function declineExecutor(home: string) { saveState(home, { offered: true, declined: true }); }
export function offerExecutor(options: ExecutorOptions, found = detectExecutor(options)) {
  if (!found.detected || executorState(options.home).offered || executorState(options.home).setup) return;
  saveState(options.home, { offered: true });
  return { status: 'offer_executor', question: 'You use Executor. Hive can be a connection there too, so every app and agent you run through it shares the same memory. Set it up?', picker: { options: ['Yes', 'Not now'] }, options: [
    { label: 'Yes', args: ['install', '--client', 'executor'] },
    { label: 'Not now', args: ['install', '--skip-executor'] },
  ] };
}

export function executorEndpoint(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use an Executor MCP URL without credentials or query parameters');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) throw new Error('Use HTTPS for a remote Executor server');
  if (!parsed.pathname.replace(/\/$/, '').endsWith('/mcp')) throw new Error('The Executor MCP URL must end with /mcp');
  return parsed.href.replace(/\/$/, '');
}
function hiveEndpoint(env: NodeJS.ProcessEnv = process.env) {
  return executorEndpoint(new URL('/api/mcp', env.HIVE_URL || url).href);
}
export function executorSetupLink(endpoint?: string): string {
  if (!endpoint) return 'https://app.executor.sh';
  const parsed = new URL(executorEndpoint(endpoint));
  if (parsed.hostname === 'mcp.executor.sh' || parsed.hostname === 'app.executor.sh') return 'https://app.executor.sh';
  const prefix = parsed.pathname.replace(/\/mcp\/?$/, '');
  const link = new URL(`${prefix}/integrations/add/mcp`, parsed.origin);
  link.searchParams.set('url', url);
  return link.href;
}

export function detectExecutor(options: ExecutorOptions): ExecutorDetection {
  const env = options.env || process.env;
  const run = options.run || runCommand;
  const version = run('executor', ['--version'], options.home);
  const signals: string[] = version.status === 0 ? ['CLI'] : [];
  if ([join(options.home, '.executor'), join(env.XDG_CONFIG_HOME || join(options.home, '.config'), 'executor')].some(path => { try { return statSync(path).isDirectory(); } catch { return false; } })) signals.push('config directory');
  if (env.HIVE_EXECUTOR_TOOLS === '1') signals.push('session tools');
  let endpoint = options.endpoint ? executorEndpoint(options.endpoint) : undefined;
  if (!endpoint) {
    try {
      const path = join(options.home, '.claude.json');
      const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
      const candidate = Object.entries(config.mcpServers || {}).find(([name, raw]) => {
        const server = raw as { url?: string };
        return server.url && (/executor/i.test(name) || new URL(server.url).hostname.endsWith('executor.sh'));
      })?.[1] as { url?: string } | undefined;
      if (candidate?.url) endpoint = executorEndpoint(candidate.url);
    } catch {}
  }
  if (endpoint) signals.push('MCP config');
  return { detected: signals.length > 0, cli: version.status === 0, signals, ...(version.status === 0 ? { version: version.stdout.trim() } : {}), ...(endpoint ? { endpoint } : {}) };
}
export function reportExecutorDetection(found: ExecutorDetection, log = console.log) {
  log(`Executor detection: ${found.detected ? `Detected (${found.signals.join(', ')})` : 'Not detected'}`);
}

function call(options: ExecutorOptions, path: string[], input: object): { ok: boolean; data?: Record<string, unknown> } | undefined {
  const result = (options.run || runCommand)('executor', ['call', 'executor', ...path, JSON.stringify(input)], options.home);
  if (result.status !== 0) return;
  try { return JSON.parse(result.stdout); } catch { return; }
}
type RemoteIntegration = { slug: string; config?: { endpoint?: string }; endpoint?: string };
type Connection = { integration: string; owner?: 'user' | 'org'; name?: string; lastHealth?: { status?: string } };
function findHive(options: ExecutorOptions): { checked: boolean; integration?: RemoteIntegration; connected?: boolean; mismatch?: boolean; connection?: Connection } {
  const connections = call(options, ['coreTools', 'connections', 'list'], {});
  const list = call(options, ['coreTools', 'integrations', 'list'], {});
  if (!connections?.ok || !Array.isArray(connections.data?.connections) || !list?.ok || !Array.isArray(list.data?.integrations)) return { checked: false };
  const candidates = (list.data.integrations as { slug: string; kind?: string }[]).filter(item => item.kind === 'mcp').sort((a, b) => Number(/hive/i.test(b.slug)) - Number(/hive/i.test(a.slug)));
  let mismatch = false;
  let existing: RemoteIntegration | undefined;
  let savedConnection: Connection | undefined;
  for (const candidate of candidates) {
    const result = call(options, ['mcp', 'getServer'], { slug: candidate.slug });
    if (!result?.ok) return { checked: false };
    const integration = result.data?.integration as RemoteIntegration | undefined;
    const endpoint = (integration?.config?.endpoint || integration?.endpoint)?.replace(/\/$/, '');
    if (endpoint === hiveEndpoint(options.env)) {
      const saved = (connections.data.connections as Connection[]).filter(connection => connection.integration === candidate.slug);
      if (saved.some(connection => connection.lastHealth?.status === 'healthy')) return { checked: true, integration: { ...integration, slug: candidate.slug }, connected: true };
      if (!existing) { existing = { ...integration, slug: candidate.slug }; savedConnection = saved.find(connection => connection.owner === 'user') || saved[0]; }
    }
    if (candidate.slug === 'hive') mismatch = true;
  }
  return { checked: true, integration: existing, connection: savedConnection, mismatch: !existing && mismatch };
}

export function doctorExecutor(options: ExecutorOptions): boolean {
  const log = options.log || console.log;
  const found = detectExecutor(options);
  if (!found.cli) { log(`Executor: ${found.detected ? 'Connection check needed. Ask the session tools to check Hive' : 'Not detected'}`); return false; }
  if (!found.endpoint && !found.signals.includes('config directory')) { log('Executor: Connection check needed. Open Executor and sign in to your existing account'); return false; }
  const result = findHive(options);
  log(`Executor: ${!result.checked ? 'Connection check failed. Check the active Executor profile' : result.connected ? 'Connected' : result.integration ? 'Sign-in needed. Open the Hive connection in Executor' : 'Hive is not connected. Run npx gohive install --client executor'}`);
  return Boolean(result.connected);
}

export function installExecutor(options: ExecutorOptions) {
  const log = options.log || console.log;
  const found = detectExecutor(options);
  const endpoint = hiveEndpoint(options.env);
  const fallback = (reason?: string) => {
    if (reason) log(reason);
    log('In Executor, choose Add app → Quick Add.');
    log(`Choose remote MCP server; name it Hive and use ${endpoint}.`);
    log('Choose OAuth, then open its connection link and sign in as yourself.');
    return { status: 'quick_add', endpoint, name: 'Hive', auth: 'oauth2', detection: found };
  };
  if (!options.dryRun) saveState(options.home, { offered: true, setup: true, declined: false });
  if (!found.cli) return fallback();
  if (!found.endpoint && !found.signals.includes('config directory')) return fallback('Executor CLI has no saved profile. Open Executor and sign in to your existing account.');
  const result = findHive(options);
  if (!result.checked) {
    log('Executor: Connection check failed. Check the active Executor profile before adding Hive.');
    return { status: 'check_failed', detection: found };
  }
  if (result.connected) {
    log('Hive is already connected in Executor');
    if (!options.dryRun) saveState(options.home, { state: 'connected' });
    return { status: 'already_connected', detection: found };
  }
  if (result.connection?.owner === 'org') return fallback('Executor: Open the existing organisation Hive connection to finish sign-in.');
  if (result.mismatch) return fallback('Executor: The name hive belongs to a different server. Keep that app intact.');
  const registration = { name: 'Hive', slug: 'hive', endpoint, transport: 'remote', remoteTransport: 'streamable-http', auth: { kind: 'oauth2' } };
  const help = (options.run || runCommand)('executor', ['call', 'executor', 'mcp', 'addServer', '--help'], options.home);
  if (help.status !== 0 || !help.stdout.includes('endpoint')) return fallback('Executor CLI cannot register a remote MCP server non-interactively.');
  if (options.dryRun) {
    log(JSON.stringify({ status: 'dry_run', command: ['executor', 'call', 'executor', 'mcp', 'addServer', JSON.stringify(registration)], existing: result.integration?.slug }));
    return { status: 'dry_run', detection: found };
  }
  const metadata = call(options, ['coreTools', 'oauth', 'probe'], { url: endpoint });
  const clients = call(options, ['coreTools', 'oauth', 'clients', 'list'], {});
  if (!metadata?.ok || !clients?.ok || !Array.isArray(clients.data?.clients)) return fallback('Executor: OAuth discovery needs attention.');
  const entries = clients.data.clients as { owner: 'user' | 'org'; slug: string; resource?: string; grant?: string }[];
  let client = entries.find(client => client.owner === 'user' && client.resource === endpoint && client.grant === 'authorization_code');
  if (!client && typeof metadata.data?.registrationEndpoint !== 'string') return fallback('Executor: Set up the OAuth client in Quick Add.');
  let slug = result.integration?.slug;
  if (!slug) {
    const added = call(options, ['mcp', 'addServer'], registration);
    if (!added?.ok || typeof added.data?.slug !== 'string') return fallback('Executor: Remote MCP registration needs attention.');
    slug = added.data.slug;
  }
  if (!client) {
    const created = call(options, ['coreTools', 'oauth', 'clients', 'registerDynamic'], {
      owner: 'user', slug: 'hive-installer', originIntegration: slug, clientName: 'Hive for Executor',
      issuer: metadata.data?.issuer, registrationEndpoint: metadata.data?.registrationEndpoint,
      authorizationUrl: metadata.data?.authorizationUrl, tokenUrl: metadata.data?.tokenUrl,
      resource: endpoint, scopes: metadata.data?.scopesSupported || ['hive', 'offline_access'],
      tokenEndpointAuthMethodsSupported: metadata.data?.tokenEndpointAuthMethodsSupported,
    });
    if (!created?.ok || typeof created.data?.client !== 'string') return fallback('Executor: OAuth client registration needs attention. Reuse the Hive app.');
    client = { owner: 'user', slug: created.data.client };
  }
  const started = call(options, ['coreTools', 'oauth', 'start'], { client: client.slug, clientOwner: client.owner, owner: 'user', name: result.connection?.name || 'hive', integration: slug, template: 'oauth2' });
  if (!started?.ok || typeof started.data?.authorizationUrl !== 'string') return fallback('Executor: Open the existing Hive app to finish OAuth.');
  const link = started.data.authorizationUrl;
  const parsed = new URL(link);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) return fallback('Executor: The connection link must use HTTPS.');
  saveState(options.home, { state: 'needs_connection' });
  log(link);
  log('Click it once to connect; then run `npx gohive status`.');
  return { status: 'needs_connection', link, detection: found };
}

export function installExecutorBearer(options: ExecutorOptions) {
  const log = options.log || console.log;
  log('Executor uses human OAuth. Run npx gohive install --client executor; the local agent credential stays private.');
  return false;
}
