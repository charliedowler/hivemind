import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const root = process.env.HIVE_E2E_ROOT;
if (!root || !process.env.HIVE_URL) throw new Error('Network guard requires a scratch machine');
appendFileSync(`${root}/child-pids.jsonl`, JSON.stringify({ pid: process.pid, root }) + '\n', { mode: 0o600 });
const loopback = host => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
const allowed = host => loopback(host) || (process.env.HIVE_E2E_MODE === 'real' && /^(?:api\.anthropic\.com|claude\.ai|api\.openai\.com|chatgpt\.com|auth\.openai\.com|platform\.claude\.com)$/.test(host));
function check(value) {
  const host = value instanceof URL ? value.hostname : typeof value === 'string' ? new URL(value).hostname : value?.hostname || value?.host || 'localhost';
  if (!allowed(host)) {
    appendFileSync(process.env.HIVE_E2E_LOG, JSON.stringify({ kind: 'network-rejected', host }) + '\n', { mode: 0o600 });
    throw new Error(`E2E blocked external request to ${host}`);
  }
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  check(input instanceof Request ? input.url : input);
  const response = await originalFetch(input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    check(new URL(response.headers.get('location'), response.url));
    if (init.redirect === 'error') throw new Error('E2E fetch redirect refused');
  }
  return response;
};
for (const module of [http, https]) for (const name of ['request', 'get']) {
  const original = module[name];
  module[name] = function (input, ...rest) { check(input); return original.call(this, input, ...rest); };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (input && typeof input === 'object' && !input.path) check(input);
  else if (typeof input === 'number') check({ hostname: typeof args[1] === 'string' ? args[1] : 'localhost' });
  return connect.apply(this, args);
};
syncBuiltinESMExports();
