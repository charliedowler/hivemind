import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [command, ...args] = process.argv.slice(2);
const home = process.env.HOME;
const log = value => appendFileSync(process.env.HIVE_E2E_LOG, JSON.stringify(value) + '\n', { mode: 0o600 });
const safeArgs = args.map((arg, index) => /authorization|bearer|token/i.test(args[index - 1] || '') || /Bearer /i.test(arg) ? '[REDACTED]' : arg);
log({ kind: 'cli', command, args: safeArgs });
const fail = message => { process.stderr.write(message + '\n'); process.exit(1); };
const read = file => existsSync(file) ? readFileSync(file, 'utf8') : '';
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 }); writeFileSync(file, value, { mode: 0o600 }); };
const local = value => {
  const url = new URL(value);
  if (url.origin !== new URL(process.env.HIVE_URL).origin) fail('E2E refuses a nonlocal Hive endpoint');
  return url;
};
if (command === 'open' || command === 'xdg-open') {
  local(args[0]);
  log({ kind: 'browser', url: args[0] });
} else if (command === 'curl') {
  const target = args.find(arg => /^https?:/.test(arg));
  if (!target) fail('The e2e curl wrapper requires a local URL');
  const response = await fetch(local(target));
  if (!response.ok) fail(`Local curl returned ${response.status}`);
  process.stdout.write(await response.text());
} else if (command === 'npx' || command === 'gohive') {
  let forwarded = [...args];
  if (command === 'npx') {
    if (forwarded[0] === '--yes' || forwarded[0] === '-y') forwarded.shift();
    if (!/^gohive(?:@(?:latest|\d+\.\d+\.\d+))?$/.test(forwarded.shift() || '')) fail('Only the locally built gohive installer is allowed');
    if (Number(process.env.npm_config_minimum_release_age || '0') > 0) fail('Package refused by minimum release age policy. Do not bypass this policy.');
  }
  if (process.env.HIVE_E2E_MODE === 'real') {
    const installer = await import(new URL('./installer.js', `file://${process.env.HIVE_E2E_INSTALLER}`).href);
    if (process.env.HIVE_E2E_LOCAL_CONFIG_OVERRIDE !== '1') local(installer.url);
  }
  const result = spawnSync(process.env.HIVE_E2E_NODE, [process.env.HIVE_E2E_INSTALLER, ...forwarded], { env: process.env, stdio: 'inherit', timeout: 45000 });
  if (process.env.HIVE_E2E_MODE === 'real' && process.env.HIVE_E2E_REAL_CLIENT === 'claude' && existsSync(join(home, '.claude.json'))) {
    copyFileSync(join(home, '.claude.json'), join(home, '.claude/.claude.json'));
    log({ kind: 'setup-deviation', detail: 'Copied scratch installer config into the isolated CLAUDE_CONFIG_DIR namespace.' });
  }
  process.exitCode = result.status ?? 1;
} else if (command === 'claude' || command === 'codex') {
  if (process.env.HIVE_E2E_MODE === 'real' && command === process.env.HIVE_E2E_REAL_CLIENT) {
    const endpoint = args.find(arg => /^https?:/.test(arg));
    const allowed = [
      ['--version'], ['mcp', 'list'], ['mcp', 'list', '--json'], ['mcp', 'get', 'hive'], ['mcp', 'get', 'hive', '--json'],
      ...(command === 'claude' ? [['mcp', 'remove', 'hive', '--scope', 'user'], ['mcp', 'add', '--transport', 'http', 'hive', endpoint, '--scope', 'user']] : [['mcp', 'remove', 'hive'], ['mcp', 'add', 'hive', '--url', endpoint]]),
    ];
    if (!allowed.some(value => JSON.stringify(value) === JSON.stringify(args))) fail('Native fixture shim permits only installer version and Hive MCP configuration operations; model invocations are forbidden');
    if (process.env.HIVE_E2E_LOCAL_CONFIG_OVERRIDE === '1' && args[0] === 'mcp' && args[1] === 'add') {
      for (let i = 0; i < args.length; i++) if (args[i] === 'https://gohive.dev/api/mcp') {
        args[i] = `${process.env.HIVE_URL}/api/mcp`;
        log({ kind: 'setup-deviation', detail: 'Installer ignores HIVE_URL. Native MCP registration URL overridden inside the scratch machine.', command });
      }
    }
    const urls = args.filter(arg => /^https?:/.test(arg));
    urls.forEach(local);
    const disable = command === 'codex' ? ['apps', 'plugins', 'remote_plugin', 'enable_mcp_apps', 'skill_mcp_dependency_install'].flatMap(feature => ['--disable', feature]) : [];
    const result = spawnSync(process.env.HIVE_E2E_REAL_EXECUTABLE, [...disable, ...args], { env: process.env, stdio: 'inherit', timeout: 30000 });
    process.exitCode = result.status ?? 1;
  } else if (process.env.HIVE_E2E_MODE === 'real') {
    fail('Only the selected real agent is available');
  } else if (args[0] === '--version') {
    process.stdout.write(command === 'claude' ? '2.1.296 (Claude Code)\n' : 'codex-cli 0.162.1\n');
  } else {
    if (args[0] !== 'mcp') fail('Fake CLIs only model native MCP configuration');
    const operation = args[1];
    const file = command === 'claude' ? join(home, '.claude.json') : join(home, '.codex/config.toml');
    const claude = JSON.parse(command === 'claude' ? read(file) || '{}' : '{}');
    const toml = command === 'codex' ? read(file) : '';
    const url = command === 'claude' ? claude.mcpServers?.hive?.url : toml.match(/^url = "([^"]+)"$/m)?.[1];
    if (operation === 'get') {
      if (!url) fail('No MCP server found');
      process.stdout.write(JSON.stringify({ name: 'hive', transport: { type: 'streamable_http', url } }) + '\n');
    } else if (operation === 'add') {
      const endpoint = args.find(arg => /^https?:/.test(arg));
      if (!endpoint) fail('Missing MCP URL');
      if (command === 'claude') {
        claude.mcpServers ||= {};
        claude.mcpServers.hive = { type: 'http', url: endpoint };
        const headerIndex = args.findIndex(arg => arg === '--header' || arg === '-H');
        if (headerIndex !== -1) {
          const [name, ...parts] = args[headerIndex + 1].split(':');
          claude.mcpServers.hive.headers = { [name]: parts.join(':').trim() };
        }
        write(file, JSON.stringify(claude, null, 2));
      } else {
        const tokenIndex = args.indexOf('--bearer-token-env-var');
        write(file, `${toml}\n[mcp_servers.hive]\nurl = ${JSON.stringify(endpoint)}\n${tokenIndex !== -1 ? `bearer_token_env_var = ${JSON.stringify(args[tokenIndex + 1])}\n` : ''}`);
      }
      process.stdout.write('MCP configuration saved\n');
    } else if (operation === 'list') {
      process.stdout.write(url ? 'hive: configured (network health not checked by fixture)\n' : '');
    } else if (operation === 'remove') {
      if (command === 'claude') { delete claude.mcpServers?.hive; write(file, JSON.stringify(claude)); }
      else write(file, toml.replace(/\n?\[mcp_servers\.hive\][\s\S]*?(?=\n\[|$)/, ''));
    } else fail(`Fake CLI cannot authenticate or run business operations: ${operation}`);
  }
} else fail('Unsupported fixture executable');
