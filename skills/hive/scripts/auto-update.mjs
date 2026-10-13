import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homeDirectory, endpoint } from './mcp.mjs';

const day = 24 * 60 * 60 * 1000;
const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(part => Number.isSafeInteger(Number(part)));
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const write = (path, value) => {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 });
  renameSync(temp, path);
};
export function compareVersions(left, right) {
  if (!validVersion(left) || !validVersion(right)) throw new Error('Invalid Hive version');
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export const optedOut = (home, env = process.env) => env.HIVE_NO_AUTO_UPDATE === '1' || existsSync(join(home, '.hive/no-auto-update'));
export function takeNotice(home = homeDirectory()) {
  const path = join(home, '.hive/update.json');
  const state = read(path);
  const notices = [];
  if (state.notice) { notices.push(state.notice); delete state.notice; write(path, state); }
  const oauthPath = join(home, '.hive/oauth-update-notice.json');
  const oauth = read(oauthPath);
  if (oauth.pending) {
    notices.push('Hive kept your OAuth connection. Run `npx gohive@latest install` to switch to the credential flow if you want it.');
    write(oauthPath, { pending: false });
  }
  return notices.join('\n');
}
export function startUpdate({ home, latest, minimum, installed }) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--run', home, latest, minimum, installed], {
    cwd: home, detached: true, stdio: 'ignore', env: { ...process.env, HOME: home, HIVE_HOME: home, CODEX_HOME: join(home, '.codex') },
  });
  child.on('error', () => {});
  child.unref();
}
export async function checkForUpdate({ home = homeDirectory(), baseUrl = endpoint(), env = process.env, now = Date.now(), fetcher = fetch, launch = startUpdate } = {}) {
  try {
    const manifest = read(join(home, '.hive/install.json'));
    if (!manifest.agents?.length && !manifest.executor) return '';
    const notice = takeNotice(home);
    if (optedOut(home, env)) return notice;
    const path = join(home, '.hive/update.json');
    let state = read(path);
    if (state.checkedAt && now - state.checkedAt < day) return notice;
    const lockPath = join(home, '.hive/update-check.lock');
    let lock;
    try {
      if (existsSync(lockPath) && now - statSync(lockPath).mtimeMs > 10000) unlinkSync(lockPath);
      lock = openSync(lockPath, 'wx', 0o600);
    } catch { return notice; }
    try {
      state = read(path);
      if (state.checkedAt && now - state.checkedAt < day) return notice;
      write(path, { ...state, checkedAt: now });
      const signal = AbortSignal.timeout(2000);
      const response = await fetcher(new URL('/api/cli/version', baseUrl), { signal, redirect: 'error' });
      if (!response.ok) return notice;
      const { latest, minimum } = await response.json();
      if (!validVersion(latest) || !validVersion(minimum) || compareVersions(minimum, latest) > 0) return notice;
      const installed = validVersion(manifest.installedVersion) ? manifest.installedVersion : Object.keys(manifest.files || {}).some(path => path.endsWith('/scripts/agent-headers.mjs')) ? '0.2.0' : '0.1.0';
      if (compareVersions(installed, latest) >= 0) { write(path, { ...state, checkedAt: now, latest, minimum }); return notice; }
      write(path, { ...state, checkedAt: now, latest, minimum, status: 'pending' });
      launch({ home, latest, minimum, installed });
      if (compareVersions(installed, minimum) < 0) return [notice, 'Hive is updating in the background. Before your final answer, read ~/.hive/update.json after status is no longer pending, then consume the notice with node ~/.claude/skills/hive/scripts/auto-update.mjs --notice (Codex: ~/.codex/skills/hive/scripts/auto-update.mjs). On success say exactly one line "Hive updated to ' + latest + '". On failure say exactly "Hive needs an update: run `npx gohive@latest install`". Do not delay the task for the update.'].filter(Boolean).join('\n');
      return notice;
    } catch { return notice; }
    finally { closeSync(lock); unlinkSync(lockPath); }
  } catch { return ''; }
}
export async function runUpdate({ home, latest, minimum, installed, env = process.env, run = runInstaller }) {
  if (optedOut(home, env) || !validVersion(latest) || !validVersion(minimum) || !validVersion(installed)) return;
  const path = join(home, '.hive/update.json');
  const lockPath = join(home, '.hive/update-install.lock');
  let lock;
  try {
    if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 10 * 60 * 1000) unlinkSync(lockPath);
    lock = openSync(lockPath, 'wx', 0o600);
  } catch { return; }
  try {
    const success = await run(home, latest);
    const current = read(join(home, '.hive/install.json')).installedVersion;
    const complete = success && validVersion(current) && compareVersions(current, latest) >= 0;
    const notice = compareVersions(installed, minimum) < 0 ? complete ? `Hive updated to ${current}` : 'Hive needs an update: run `npx gohive@latest install`' : undefined;
    write(path, { ...read(path), status: complete ? 'updated' : 'failed', ...(notice ? { notice } : {}) });
  } catch {
    write(path, { ...read(path), status: 'failed', ...(compareVersions(installed, minimum) < 0 ? { notice: 'Hive needs an update: run `npx gohive@latest install`' } : {}) });
  } finally { closeSync(lock); unlinkSync(lockPath); }
}
function runInstaller(home, latest) {
  return new Promise(resolve => {
    const env = { ...process.env, HOME: home, HIVE_HOME: home, CODEX_HOME: join(home, '.codex') };
    delete env.CLAUDE_CONFIG_DIR;
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', `gohive@${latest}`, 'install', '--update'], { cwd: home, stdio: 'ignore', env, timeout: 5 * 60 * 1000 });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--run') {
    const [home, latest, minimum, installed] = process.argv.slice(3);
    runUpdate({ home, latest, minimum, installed }).catch(() => {});
  } else if (process.argv[2] === '--notice') { const notice = takeNotice(); if (notice) console.log(notice); }
  else checkForUpdate().then(notice => { if (notice) console.log(notice); }).catch(() => {});
}
