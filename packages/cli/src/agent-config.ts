import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Agent } from './installer.js';
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
export function privateWrite(path: string, value: string) {
  path = existsSync(path) && lstatSync(path).isSymbolicLink() ? realpathSync(path) : path;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, value, { mode: 0o600 });
  renameSync(temp, path);
}
export function codexHiveSection(text: string) {
  return text.match(/^\[mcp_servers\.(?:hive|"hive"|'hive')\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
}
export function writeCodexServer(home: string, endpoint: string, credential?: string) {
  const path = join(home, '.codex/config.toml');
  const current = read(path);
  const section = codexHiveSection(current);
  if (section && !new RegExp(`^url\\s*=\\s*["']${endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'm').test(section)) throw new Error('Codex has a different server called hive. Its config was kept');
  const lines = current.split('\n');
  let skip = false;
  const kept = lines.filter(line => {
    if (/^\[/.test(line.trim())) skip = /^\[mcp_servers\.(?:hive|"hive"|'hive')(?:\.|\])/.test(line.trim());
    return !skip;
  }).join('\n').trimEnd();
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const helper = [process.execPath, join(home, '.codex/skills/hive/scripts/agent-headers.mjs'), home].map(quote).join(' ');
  const auth = credential ? `\nhttp_headers_helper = ${JSON.stringify(helper)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${credential}`)} }` : '';
  privateWrite(path, `${kept}${kept ? '\n\n' : ''}[mcp_servers.hive]\nurl = ${JSON.stringify(endpoint)}\nenabled = true${auth}\n`);
}
export function writeClaudeServer(home: string, endpoint: string, credential?: string) {
  const path = join(home, '.claude.json');
  const config = JSON.parse(read(path) || '{}');
  const existing = config.mcpServers?.hive;
  if (existing && (existing.type !== 'http' || existing.url?.replace(/\/$/, '') !== endpoint.replace(/\/$/, ''))) throw new Error('Claude Code has a different server called hive. Its config was kept');
  config.mcpServers = { ...config.mcpServers, hive: { type: 'http', url: endpoint, ...(credential ? { headers: { Authorization: `Bearer ${credential}` } } : {}) } };
  privateWrite(path, JSON.stringify(config, null, 2) + '\n');
}
export function configureAgentBearer(home: string, agents: Agent[], credential: string, endpoint = 'https://gohive.dev/api/mcp', log = console.log) {
  const configured: Agent[] = [];
  for (const agent of agents) {
    try {
      if (agent === 'claude') writeClaudeServer(home, endpoint, credential);
      else writeCodexServer(home, endpoint, credential);
      configured.push(agent);
    } catch { log(`${agent === 'claude' ? 'Claude Code' : 'Codex'} needs attention: its existing Hive config was kept. Your other clients are ready.`); }
  }
  const path = join(home, '.hive/install.json');
  if (existsSync(path)) {
    const manifest = JSON.parse(read(path));
    manifest.registered = [...new Set([...manifest.registered, ...configured])];
    privateWrite(path, JSON.stringify(manifest, null, 2) + '\n');
  }
  return configured;
}
