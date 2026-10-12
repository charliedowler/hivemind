import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const hiveUrl = 'https://gohive.dev';
export const homeDirectory = () => process.env.HIVE_HOME || process.env.HOME || homedir();
export const endpoint = () => process.env.HIVE_URL || hiveUrl;

export function saveCredentials(value, home = homeDirectory()) {
  const directory = join(home, '.hive');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `oauth-${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, join(directory, 'oauth.json'));
}

export async function bearerToken(home = homeDirectory(), baseUrl = endpoint(), signal) {
  try {
    const stored = JSON.parse(readFileSync(join(home, '.hive/oauth.json'), 'utf8'));
    if (stored.baseUrl === baseUrl && stored.access_token) {
      if (!stored.expires_at || stored.expires_at > Date.now() + 30000) return stored.access_token;
      if (stored.refresh_token && stored.token_endpoint) {
        const response = await fetch(stored.token_endpoint, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refresh_token, client_id: stored.client_id, resource: `${baseUrl}/api/mcp` }),
        });
        if (response.ok) {
          const tokens = await response.json();
          if (typeof tokens.access_token === 'string') {
            saveCredentials({ ...stored, ...tokens, expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 }, home);
            return tokens.access_token;
          }
        }
      }
    }
  } catch {}
  if (process.env.HIVE_KEY) return process.env.HIVE_KEY;
  try {
    const server = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers?.hive;
    if (server?.url?.replace(/\/$/, '') === `${baseUrl}/api/mcp`) return server.headers?.Authorization?.replace(/^Bearer /i, '');
  } catch {}
}

async function readRpc(response, expectedId) {
  if (!response.ok) throw new Error(`Hive returned HTTP ${response.status}`);
  if (response.status === 202 || response.status === 204) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    size += value?.length || 0;
    if (size > 2000000) { await reader.cancel(); throw new Error('Hive response is too large'); }
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) {
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const message = JSON.parse(data);
        if (message.id === expectedId) { await reader.cancel(); return message; }
      }
    } else if (done) return buffer ? JSON.parse(buffer) : null;
    if (done) throw new Error('Hive ended the response without a result');
  }
}

export async function callTool(name, args, { baseUrl = endpoint(), token, signal = AbortSignal.timeout(2000) } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'User-Agent': 'gohive-hooks/0.1.0', 'MCP-Protocol-Version': '2025-03-26' };
  let session;
  async function rpc(method, params, id) {
    const response = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST', signal,
      headers: { ...headers, ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id === undefined ? {} : { id }) }),
    });
    session = response.headers.get('mcp-session-id') || session;
    const result = await readRpc(response, id);
    if (result?.error) throw new Error('Hive could not complete the MCP call');
    return result?.result;
  }
  const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'gohive-hooks', version: '0.1.0' } }, 1);
  if (initialized?.protocolVersion) headers['MCP-Protocol-Version'] = initialized.protocolVersion;
  await rpc('notifications/initialized', {}, undefined);
  try {
    const result = await rpc('tools/call', { name, arguments: args }, 2);
    if (result?.isError) throw new Error('Hive could not complete the tool call');
    return result;
  } finally {
    if (session) await fetch(`${baseUrl}/api/mcp`, { method: 'DELETE', headers: { ...headers, 'Mcp-Session-Id': session }, signal }).catch(() => {});
  }
}
