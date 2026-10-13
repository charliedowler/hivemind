import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { displayName, type Identity } from './identity.js';
import type { Agent } from './installer.js';

type SignInState = { attempt: string; started: number; pid?: number; identity: Identity; phase: string; agents?: Agent[]; url?: string; joinPhrase?: string };
const statePath = (home: string) => join(home, '.hive/sign-in.json');
export function signInState(home: string): SignInState | undefined {
  try { return JSON.parse(readFileSync(statePath(home), 'utf8')); } catch { return undefined; }
}
export function joinPhrase(value?: string): string | undefined {
  if (!value) return;
  let phrase = value.trim();
  try { const url = new URL(phrase); if (url.origin !== 'https://gohive.dev') throw new Error(); phrase = url.pathname.match(/^\/j\/([a-z]+-[a-z]+-[a-z]+)\/?$/)?.[1] || ''; } catch { if (phrase.includes('://')) throw new Error('Use a Hive join link from gohive.dev'); }
  if (!/^[a-z]+-[a-z]+-[a-z]+$/.test(phrase)) throw new Error('Use the three-word Hive phrase or its /j/ link');
  return phrase;
}
export async function beginSignIn({ home, agents, identity, headless = false, phrase, force = false, log = console.log }: { home: string; agents: Agent[]; identity: Identity; headless?: boolean; phrase?: string; force?: boolean; log?: (line: string) => void }) {
  const previous = signInState(home);
  force = force || Boolean(previous && previous.identity !== identity && ['starting', 'waiting', 'native-waiting'].includes(previous.phase));
  if (force && previous?.pid && Date.now() - previous.started < 600000 && ['starting', 'waiting', 'native-waiting'].includes(previous.phase)) { try { process.kill(previous.pid); } catch {} }
  if (!force && previous?.pid && Date.now() - previous.started < 600000 && ['starting', 'waiting', 'native-waiting'].includes(previous.phase)) {
    try { process.kill(previous.pid, 0); announce(previous, headless, log); return; } catch {}
  }
  if (!force && existsSync(join(home, '.hive/oauth.json'))) { status(home, phrase, log); return; }
  mkdirSync(join(home, '.hive'), { recursive: true, mode: 0o700 });
  const state: SignInState = { attempt: randomUUID(), started: Date.now(), identity, phase: 'starting', agents, joinPhrase: phrase };
  const temp = `${statePath(home)}.${state.attempt}.tmp`;
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 }); renameSync(temp, statePath(home));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, HIVE_HOME: home, CODEX_HOME: join(home, '.codex'), HIVE_IDENTITY: identity, HIVE_AGENT_NAME: displayName(process.env), HIVE_SIGN_IN_ATTEMPT: state.attempt, HIVE_SIGN_IN_CLIENT: agents.length === 1 ? agents[0] : '', HIVE_NATIVE_CODEX: agents.includes('codex') ? '1' : '0', ...(headless ? { HIVE_NO_BROWSER: '1' } : {}) };
  delete env.CLAUDE_CONFIG_DIR;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../assets/hive/scripts/login.mjs', import.meta.url))], { env, cwd: home, detached: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
  for (let i = 0; i < 40; i++) {
    const current = signInState(home);
    if (current?.url || current?.phase === 'failed' || current?.phase === 'connected') { announce(current, headless, log); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  log('Sign-in is starting in the background. Run gohive status to continue.');
}
function announce(state: SignInState, headless: boolean, log: (line: string) => void) {
  if (state.phase === 'failed') { log('Sign-in did not finish. Run gohive login to try again.'); return; }
  if (state.url) log(`Open ${state.url}`);
  if (state.identity === 'human') log(headless ? 'Sign in with Google at that link, then run gohive status.' : "Sign in with Google in the tab that just opened; run `npx gohive status` when done.");

}
export function status(home: string, phrase?: string, log = console.log): boolean {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../assets/hive/scripts/status.mjs', import.meta.url)), ...(phrase ? [phrase] : [])], { env: { ...process.env, HOME: home, HIVE_HOME: home, CODEX_HOME: join(home, '.codex') }, cwd: home, encoding: 'utf8', timeout: 18000 });
  if (result.stdout) for (const line of result.stdout.trim().split('\n')) log(line);
  if (result.status !== 0) { log('Run gohive login to finish signing in, then gohive status.'); return false; }
  return true;
}
