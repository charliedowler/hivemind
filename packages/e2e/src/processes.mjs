import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { createWriteStream, mkdirSync } from 'node:fs';

export const children = new Set();

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export function start(command, args, options = {}) {
  const { log, ...spawnOptions } = options;
  if (log) mkdirSync(dirname(log), { recursive: true });
  const stream = log ? createWriteStream(log, { mode: 0o600 }) : null;
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...spawnOptions });
  children.add(child);
  let stdout = '', stderr = '';
  child.stdout?.on('data', chunk => { stdout += chunk; stream?.write(chunk); });
  child.stderr?.on('data', chunk => { stderr += chunk; stream?.write(chunk); });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => {
      children.delete(child);
      stream?.end();
      resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, completed, output: () => ({ stdout, stderr }) };
}

export async function command(command, args, options = {}) {
  const { timeout = 120000, ...rest } = options;
  const job = start(command, args, rest);
  const timer = setTimeout(() => stop(job.child), timeout);
  try {
    const result = await job.completed;
    if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.code}: ${result.stderr || result.stdout}`);
    return result;
  } finally { clearTimeout(timer); }
}

export async function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 1500);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

export async function stopAll() { await Promise.all([...children].map(stop)); }
