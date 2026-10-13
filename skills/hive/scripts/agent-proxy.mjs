import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeDirectory } from './mcp.mjs';
const home = process.argv[2] || homeDirectory();
const lines = createInterface({ input: process.stdin });
let session;
let protocol = '2025-03-26';
let chain = Promise.resolve();
async function forward(line) {
  const message = JSON.parse(line);
  const state = JSON.parse(readFileSync(join(home, '.hive/agent.json'), 'utf8'));
  if (!/^ha_[A-Za-z0-9_-]{43}$/.test(state.credential || '')) throw new Error('Agent claim pending');
  const response = await fetch(`${state.baseUrl}/api/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${state.credential}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocol, ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(message), signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Hive connection failed');
  session = response.headers.get('mcp-session-id') || session;
  if (message.id === undefined || response.status === 202 || response.status === 204) { await response.body?.cancel(); return; }
  let rpc;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', bytes = 0;
    try {
      while (!rpc) {
        const {value,done} = await reader.read();
        bytes += value?.length || 0;
        if (bytes > 2_000_000) throw new Error('Hive response too large');
        buffer += decoder.decode(value, {stream: !done});
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || '';
        for (const event of events) {
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (parsed.id === message.id) rpc = parsed;
        }
        if (done && !rpc) throw new Error('Hive ended its response');
      }
    } finally { await reader.cancel(); }
  } else rpc = await response.json();
  if (rpc.result?.protocolVersion) protocol = rpc.result.protocolVersion;
  process.stdout.write(JSON.stringify(rpc) + '\n');
}
lines.on('line', line => { chain = chain.then(() => forward(line)).catch(() => { try { const message = JSON.parse(line); if (message.id !== undefined) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'Hive is unavailable or this agent needs to claim its account.'}})+'\n'); } catch {} }); });
