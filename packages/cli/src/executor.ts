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

export function doctorExecutor(options: ExecutorOptions): boolean {
  const log = options.log || console.log;
  const found = detectExecutor(options);
  if (!found.detected) { log('Executor: Not detected. Use --executor-url with your organisation MCP endpoint'); return false; }
  log(`Executor: ${found.cli ? found.version : 'Found in the agent MCP configuration'}`);
  if (found.endpoint) log(`Executor endpoint: ${found.endpoint}`);
  if (!found.cli || !/^executor v1\./.test(found.version || '')) {
    log('Executor Hive connection: Check the Hive account in the web dashboard');
    return false;
  }
  const { checked, integration } = findHive(options);
  if (!checked) { log('Executor Hive integration: Could not check the current CLI profile'); return false; }
  if (!integration) { log('Executor Hive integration: Missing. Run npx gohive install --client executor'); return false; }
  if ((integration.config?.endpoint || integration.endpoint)?.replace(/\/$/, '') !== url) { log('Executor Hive integration: The server URL differs. Check the existing integration before changing it'); return false; }
  const slug = integration.slug || 'hive';
  log(`Executor Hive integration: ${slug}`);
  const response = call(options, ['coreTools', 'connections', 'list'], {});
  const connections = response?.ok && Array.isArray(response.data?.connections) ? response.data.connections as { integration?: string; lastHealth?: { status?: string }; template?: string }[] : [];
  const hive = connections.filter(connection => connection.integration === slug);
  const healthy = hive.some(connection => connection.lastHealth?.status === 'healthy');
  log(`Executor Hive connection: ${healthy ? 'Healthy in the current CLI profile' : hive.length ? 'Needs sign-in or a health check' : 'Not connected. Finish OAuth in the dashboard'}`);
  return healthy;
}

export function installExecutor(options: ExecutorOptions) {
  const log = options.log || console.log;
  const found = detectExecutor(options);
  let link = executorSetupLink(found.endpoint);
  log('Bring your organisation to the hive');
  if (found.cli) log(`Executor CLI: ${found.version}`);
  if (found.endpoint) log(`Executor endpoint: ${found.endpoint}`);
  else log('Choose your organisation after opening Executor. Use --executor-url to open its add screen directly');
  if (found.cli && /^executor v1\./.test(found.version || '')) {
    const probe = call(options, ['mcp', 'probeEndpoint'], { endpoint: url });
    if (probe?.ok && probe.data?.requiresOAuth === false) log('Hive browser sign-in is not live yet. Wait for the OAuth release; do not paste a key');
    const current = findHive(options).integration;
    if (current) {
      log('A Hive integration already exists. Open it and check its URL; keep its existing accounts and policies');
      if (new URL(link).pathname.endsWith('/integrations/add/mcp')) { const existing = new URL(link); existing.pathname = existing.pathname.replace('/integrations/add/mcp', `/integrations/${encodeURIComponent(current.slug || 'hive')}`); existing.search = ''; link = existing.href; }
    }
  }
  log(`Open Executor: ${link}`);
  log('1. Sign in and choose the organisation that your agent uses');
  log('2. Open Add MCP integration. The organisation link fills Server URL for you');
  log(`3. Set Display Name to Hive, Namespace to hive, and Server URL to ${url}`);
  log('4. Use OAuth browser sign-in under How does this server authenticate?. Leave request headers empty');
  log('5. Click Add integration. On Hive, add a connection and complete the browser sign-in and Hive consent');
  log('6. Confirm that Hive tools are listed. Run npx gohive doctor --client executor');
  log('For the newer Executor dashboard, use Apps, add an MCP server by URL, then connect its account on the Accounts tab');
  log('The Executor API supports mcp.addServer, followed by oauth.probe and oauth.start. Its v1 CLI exposes those tools through executor call');
  log('Choose the Hive account and permissions in the browser. Your saved Executor credentials stay private');
  if (options.open) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', link] : [link];
    const browser = spawn(command, args, { stdio: 'ignore', detached: true });
    browser.on('error', () => log('Open the printed link in your browser'));
    browser.unref();
  }
  return { link, detection: found };
}
