#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { bearerToken, callTool, homeDirectory } from './mcp.mjs';

async function codexConnected() {
  const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], cwd: homeDirectory() });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const wait = pending.get(message.id);
      if (!wait) return;
      pending.delete(message.id);
      if (message.error) wait.reject(new Error('Codex connection check failed'));
      else wait.resolve(message.result);
    } catch {}
  });
  function fail() {
    for (const wait of pending.values()) wait.reject(new Error('Codex connection check ended'));
    pending.clear();
  }
  child.on('error', fail);
  child.on('exit', fail);
  const deadline = setTimeout(() => { fail(); child.kill(); }, 10000);
  try {
    await request('initialize', { clientInfo: { name: 'gohive-doctor', version: '0.1.1' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const result = await request('mcpServerStatus/list', { serverName: 'hive', detail: 'toolsAndAuthOnly' });
    const hive = result.data?.find((server) => server.name === 'hive');
    const names = Object.values(hive?.tools || {}).map((tool) => tool.name);
    return !hive?.toolsError && ['hive_search', 'hive_push'].every((name) => names.includes(name));
  } finally { clearTimeout(deadline); lines.close(); child.kill(); }
}

async function main() {
  if (process.argv.includes('--codex')) return codexConnected();
  const signal = AbortSignal.timeout(5000);
  const token = await bearerToken(homeDirectory(), undefined, signal);
  if (!token) return false;
  await callTool('hive_recent', { since: '24h', limit: 1 }, { token, signal });
  return true;
}
main().then((healthy) => { process.exitCode = healthy ? 0 : 1; }).catch(() => { process.exitCode = 1; });
