import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runCommand, url, type Runner } from './installer.js';

export type ExecutorOptions = { home: string; endpoint?: string; run?: Runner; log?: (line: string) => void; open?: boolean };
export type ExecutorDetection = { detected: boolean; cli: boolean; version?: string; endpoint?: string };

export function executorEndpoint(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use an Executor MCP URL without credentials or query parameters');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) throw new Error('Use HTTPS for a remote Executor server');
  if (!parsed.pathname.replace(/\/$/, '').endsWith('/mcp')) throw new Error('The Executor MCP URL must end with /mcp');
  return parsed.href.replace(/\/$/, '');
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
  const run = options.run || runCommand;
  const version = run('executor', ['--version'], options.home);
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
  if (!endpoint) {
    try {
      const result = run('codex', ['mcp', 'get', 'executor', '--json'], options.home);
      if (result.status === 0) {
        const value = JSON.parse(result.stdout);
        if (value.transport?.url) endpoint = executorEndpoint(value.transport.url);
      }
    } catch {}
  }
  return { detected: version.status === 0 || !!endpoint, cli: version.status === 0, ...(version.status === 0 ? { version: version.stdout.trim() } : {}), ...(endpoint ? { endpoint } : {}) };
}

function call(options: ExecutorOptions, path: string[], input: object): { ok: boolean; data?: Record<string, unknown> } | undefined {
  const result = (options.run || runCommand)('executor', ['call', 'executor', ...path, JSON.stringify(input)], options.home);
  if (result.status !== 0) return;
  try { return JSON.parse(result.stdout); } catch { return; }
}

type RemoteIntegration = { slug: string; config?: { endpoint?: string }; endpoint?: string };

function findHive(options: ExecutorOptions): { checked: boolean; integration?: RemoteIntegration } {
  const primary = call(options, ['mcp', 'getServer'], { slug: 'hive' });
  if (!primary?.ok) return { checked: false };
  if (primary.data?.integration) return { checked: true, integration: primary.data.integration as RemoteIntegration };
  const list = call(options, ['coreTools', 'integrations', 'list'], {});
  const integrations = list?.ok && Array.isArray(list.data?.integrations) ? list.data.integrations as { slug: string; kind?: string; description?: string }[] : [];
  for (const candidate of integrations.filter(item => item.kind === 'mcp' && /hive/i.test(item.slug + ' ' + item.description)).slice(0, 5)) {
    const result = call(options, ['mcp', 'getServer'], { slug: candidate.slug });
    const integration = result?.ok ? result.data?.integration as RemoteIntegration | undefined : undefined;
    if ((integration?.config?.endpoint || integration?.endpoint)?.replace(/\/$/, '') === url) return { checked: true, integration: { ...integration, slug: candidate.slug } };
  }
  return { checked: true };
}

function executorHealth(options: ExecutorOptions, integration: RemoteIntegration): boolean {
  const response = call(options, ['coreTools', 'connections', 'list'], { integration: integration.slug || 'hive' });
  const connections = response?.ok && Array.isArray(response.data?.connections) ? response.data.connections as { integration?: string; owner?: 'org' | 'user'; name?: string; expiresAt?: number; lastHealth?: { status?: string } }[] : [];
  for (const connection of connections.filter(connection => connection.integration === (integration.slug || 'hive'))) {
    if (!connection.owner || !connection.name) continue;
    const refreshed = call(options, ['coreTools', 'connections', 'refresh'], { owner: connection.owner, name: connection.name, integration: integration.slug || 'hive' });
    const health = refreshed?.data?.lastHealth as { status?: string } | undefined;
    const tools = refreshed?.data?.tools as { name?: string }[] | undefined;
    if (refreshed?.ok && health?.status === 'healthy' && Array.isArray(tools) && tools.some(tool => tool.name === 'hive_search') && tools.some(tool => tool.name === 'hive_push')) return true;
  }
  return false;
}

export function doctorExecutor(options: ExecutorOptions): boolean {
  const log = options.log || console.log;
  try {
    const state = JSON.parse(readFileSync(join(options.home, '.hive/agent.json'), 'utf8'));
    if (state.executor && state.credential) {
      const result = call(options, ['coreTools', 'connections', 'refresh'], {owner:'user',name:'hive-agent',integration:'hive-agent'});
      const healthy = result?.ok && (result.data?.lastHealth as {status?:string})?.status === 'healthy';
      log(`Executor: ${healthy ? 'Connected' : 'Connection check needed.'}`);
      return Boolean(healthy);
    }
  } catch {}
  const found = detectExecutor(options);
  if (!found.detected) { log('Executor: Not detected. Run npx gohive@latest install --client executor --executor-url <organisation MCP URL>'); return false; }
  if (!found.cli || !/^executor v1\./.test(found.version || '')) {
    log(`Executor: Connection check needed. Open ${executorSetupLink(found.endpoint)}`);
    return false;
  }
  const { checked, integration } = findHive(options);
  if (!checked) { log('Executor: Profile check failed. Run executor login'); return false; }
  if (!integration) { log('Executor: Hive is missing. Run npx gohive@latest install --client executor'); return false; }
  if ((integration.config?.endpoint || integration.endpoint)?.replace(/\/$/, '') !== url) { log('Executor: The Hive URL differs. Open the existing integration and check its server URL'); return false; }
  const healthy = executorHealth(options, integration);
  log(`Executor: ${healthy ? 'Connected' : 'Sign-in or connection check needed. Open the Hive account in Executor'}`);
  return healthy;
}

export function installExecutor(options: ExecutorOptions) {
  const log = options.log || console.log;
  const found = detectExecutor(options);
  let link = executorSetupLink(found.endpoint);
  if (found.cli && /^executor v1\./.test(found.version || '')) {
    const { checked, integration } = findHive(options);
    if (integration && (integration.config?.endpoint || integration.endpoint)?.replace(/\/$/, '') !== url) {
      log('Executor: The existing Hive URL differs. Open the existing integration and check its server URL');
      return { link, detection: found };
    }
    if (integration && new URL(link).pathname.endsWith('/integrations/add/mcp')) {
      const existing = new URL(link);
      existing.pathname = existing.pathname.replace('/integrations/add/mcp', `/integrations/${encodeURIComponent(integration.slug || 'hive')}`);
      existing.search = '';
      link = existing.href;
    }
    if (integration && executorHealth(options, integration)) {
      log('Executor: Connected');
      return { link, detection: found };
    }
    const probe = call(options, ['mcp', 'probeEndpoint'], { endpoint: url });
    if (probe?.ok && probe.data?.requiresOAuth === false) {
      log('Executor: Hive OAuth is unavailable. Retry npx gohive@latest install --client executor when OAuth is available');
      return { link, detection: found };
    }
    let slug = integration?.slug || 'hive';
    let registered = !!integration;
    if (options.open && checked && !integration && probe?.ok && probe.data?.requiresOAuth === true) {
      const added = call(options, ['mcp', 'addServer'], { name: 'Hive', slug: 'hive', endpoint: url, transport: 'remote', remoteTransport: 'streamable-http', auth: { kind: 'oauth2' } });
      if (added?.ok && typeof added.data?.slug === 'string') { slug = added.data.slug; registered = true; }
    }
    if (registered) {
      const parsed = new URL(link);
      if (parsed.pathname.endsWith('/integrations/add/mcp')) {
        parsed.pathname = parsed.pathname.replace('/integrations/add/mcp', `/integrations/${encodeURIComponent(slug)}`);
        parsed.search = '';
        link = parsed.href;
      }
    }
    const metadata = call(options, ['coreTools', 'oauth', 'probe'], { url });
    if (metadata?.ok && options.open && registered) {
      const clients = call(options, ['coreTools', 'oauth', 'clients', 'list'], {});
      const entries = clients?.ok && Array.isArray(clients.data?.clients) ? clients.data.clients as { owner: string; slug: string; resource?: string }[] : [];
      let client = entries.find(client => client.owner === 'user' && client.resource === url);
      if (!client && clients?.ok && typeof metadata.data?.registrationEndpoint === 'string') {
        const created = call(options, ['coreTools', 'oauth', 'clients', 'registerDynamic'], {
          owner: 'user', slug: 'hive-installer', originIntegration: slug, clientName: 'Hive for Executor',
          issuer: metadata.data.issuer, registrationEndpoint: metadata.data.registrationEndpoint,
          authorizationUrl: metadata.data.authorizationUrl, tokenUrl: metadata.data.tokenUrl,
          resource: metadata.data.resource, scopes: metadata.data.scopesSupported || ['hive'],
          tokenEndpointAuthMethodsSupported: metadata.data.tokenEndpointAuthMethodsSupported,
        });
        if (created?.ok && typeof created.data?.client === 'string') client = { owner: 'user', slug: created.data.client };
      }
      if (client) {
        const started = call(options, ['coreTools', 'oauth', 'start'], {
          client: client.slug, clientOwner: client.owner, owner: 'user', name: 'hive', integration: slug, template: 'oauth2',
        });
        if (started?.ok && typeof started.data?.authorizationUrl === 'string') link = started.data.authorizationUrl;
      }
    }
  }
  log(`Executor: Sign-in needed. Open ${link}`);
  if (options.open) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', link] : [link];
    const browser = spawn(command, args, { stdio: 'ignore', detached: true });
    browser.on('error', () => {});
    browser.unref();
  }
  return { link, detection: found };
}

export function installExecutorBearer(options: ExecutorOptions) {
  const log = options.log || console.log;
  const found = detectExecutor(options);
  if (!found.cli || !/^executor v1\./.test(found.version || '')) {
    log('Executor needs attention: its local CLI is unavailable. The agent credential and skill are installed.');
    return false;
  }
  const added = call(options, ['mcp', 'addServer'], { transport: 'stdio', name: 'Hive agent', slug: 'hive-agent', command: process.execPath, args: [join(options.home, '.hive/skills/hive/scripts/agent-proxy.mjs'), options.home], spawnPerCall: true });
  if (!added?.ok || typeof added.data?.slug !== 'string') { log('Executor needs attention: its profile could not register this local agent. The credential stays private.'); return false; }
  const connection = call(options, ['coreTools', 'connections', 'create'], { owner: 'user', name: 'hive-agent', integration: added.data.slug, template: 'none' });
  if (!connection?.ok) {
    const existing = call(options, ['coreTools', 'connections', 'refresh'], { owner: 'user', name: 'hive-agent', integration: added.data.slug });
    if (!existing?.ok) { log('Executor needs attention: reconnect the local Hive agent profile.'); return false; }
  }
  log('Executor: Connected with this machine’s private agent credential.');
  return true;
}
