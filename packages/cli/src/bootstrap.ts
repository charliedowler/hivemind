import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent } from './installer.js';
import { configureAgentBearer, privateWrite, writeClaudeServer, writeCodexServer } from './agent-config.js';
import { harness } from './identity.js';
export type AgentState = { baseUrl: string; agents: Agent[]; credential?: string; agentId?: string; claimPending?: boolean; requestId?: string; pollingToken?: string; executor?: boolean; executorReady?: boolean };
const statePath = (home: string) => join(home, '.hive/agent.json');
export function readAgentState(home: string): AgentState | undefined { try { return JSON.parse(readFileSync(statePath(home), 'utf8')); } catch { return; } }
export function detectedEmail(cwd = process.cwd()): string | undefined {
  const result = spawnSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8', timeout: 2000 });
  const value = result.status === 0 ? result.stdout.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254 ? value : undefined;
}
export function emailQuestion(email?: string) {
  return { status: 'needs_email', detectedEmail: email ?? null, question: email ? `I found ${email}. Use it, or type a different one?` : 'Which email should Hive use?', picker: email ? { question: `Use ${email}?`, options: ['Yes', 'Type a different one'] } : null, next: 'Run gohive install --email <address> with the human’s answer.' };
}
function baseUrl() {
  const url = new URL(process.env.HIVE_URL || 'https://gohive.dev');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Hive requires HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a Hive URL without credentials');
  return url.origin;
}
async function request(base: string, path: string, body?: unknown, credential?: string) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000), redirect: 'error' });
  const result = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Hive returned HTTP ${response.status}`);
  return result;
}
export async function bootstrap({ home, agents, email, phrase, executor = false, log = console.log }: { home: string; agents: Agent[]; email: string; phrase?: string; executor?: boolean; log?: (line: string) => void }) {
  const previous = readAgentState(home);
  if (previous) {
    previous.agents = [...new Set([...previous.agents, ...agents])];
    previous.executor ||= executor;
    privateWrite(statePath(home), JSON.stringify(previous, null, 2) + '\n');
    if (previous.credential) configureAgentBearer(home, agents, previous.credential, `${previous.baseUrl}/api/mcp`, log);
    if (previous.credential || (previous.requestId && previous.pollingToken)) return previous;
  }
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Use a valid email address');
  const base = baseUrl();
  const result = await request(base, '/api/agents/bootstrap', { email, agentName: harness(process.env) || 'Coding agent', machine: hostname().slice(0, 80), ...(phrase ? { joinPhrase: phrase } : {}) });
  const state: AgentState = { baseUrl: base, agents, executor, ...(result.status === 'issued' ? { credential: result.credential, agentId: result.agentId, claimPending: true } : { requestId: result.requestId, pollingToken: result.pollingToken }) };
  if ((!state.credential || !/^ha_[A-Za-z0-9_-]{43}$/.test(state.credential)) && (!state.requestId || !state.pollingToken)) throw new Error('Hive did not return a connection request');
  privateWrite(statePath(home), JSON.stringify(state, null, 2) + '\n');
  if (state.credential) configureAgentBearer(home, agents, state.credential, `${base}/api/mcp`, log);
  return state;
}
export const reloadStep = 'run /mcp in Claude Code (or restart Codex)';
export const stopUntilLoaded = 'Stop here. Ask no other question until the Hive tools are loaded in this session; then read hive_agent_status and ask each remaining setup question once, only when its answer can be saved with the next tool call.';
export function nextSteps(claimPending: boolean) {
  return { status: 'next_steps', say: claimPending ? `Two steps left: click the link in your email, then ${reloadStep}. I'll finish setting up Hive after that.` : `One step left: ${reloadStep}. I'll finish setting up Hive after that.`, then: stopUntilLoaded };
}
const connectStep = { status: 'next_steps', say: 'Click the link in your email to connect this machine, then tell me when it is done.', then: 'Stop here. After they confirm, run npx --yes gohive@latest status. Ask no other question until the Hive tools are loaded in this session.' };
export async function bootstrapStatus(home: string, { announcement = false, log = console.log }: { announcement?: boolean; log?: (line: string) => void } = {}) {
  const state = readAgentState(home);
  if (!state) return false;
  if (!state.credential && state.requestId && state.pollingToken) {
    const result = await request(state.baseUrl, '/api/agents/connect', { requestId: state.requestId, pollingToken: state.pollingToken });
    if (result.status === 'pending') { log('Installed. Click the link in your email to connect this machine.'); if (announcement) log(JSON.stringify(connectStep)); return true; }
    state.credential = result.credential; state.agentId = result.agentId; state.claimPending = false;
    if (!state.credential || !/^ha_[A-Za-z0-9_-]{43}$/.test(state.credential)) throw new Error('Hive did not return an agent credential');
    delete state.pollingToken; delete state.requestId;
    privateWrite(statePath(home), JSON.stringify(state, null, 2) + '\n');
    configureAgentBearer(home, state.agents, state.credential, `${state.baseUrl}/api/mcp`, log);
  }
  if (state.executor && !state.executorReady) state.executorReady = (await import('./executor.js')).installExecutorBearer({home,log});
  const status = await request(state.baseUrl, '/api/agents/status', undefined, state.credential);
  state.claimPending = status.claimPending;
  privateWrite(statePath(home), JSON.stringify(state, null, 2) + '\n');
  log('Installed. Signed in. Hive is ready.');
  log(status.claimPending ? 'Claim pending. Your agent uses your personal hive. Click the link in your email to use your team hives.' : 'Account claimed. Your agent uses your hives.');
  for (const organisation of status.organisations || []) log(`You're in ${organisation.teamName}.`);
  if (status.joinPending && status.claimPending) log('Join pending. It will finish when you claim your account.');
  for (const item of status.joinRequests || []) log(`Join requested. Waiting for an admin of ${item.teamName}.${item.joinUrl ? ` ${item.joinUrl}` : ''}`);
  if (status.joinError) log(status.joinError);
  if (announcement) log(JSON.stringify(nextSteps(Boolean(status.claimPending))));
  if (!status.claimPending) try {
    const script = await import(new URL('../assets/hive/scripts/mcp.mjs', import.meta.url).href);
    const result = await script.callTool('hive_invite_link', {}, { baseUrl: state.baseUrl, token: state.credential, signal: AbortSignal.timeout(5000) });
    const text = result?.content?.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n');
    const invitations = JSON.parse(text || '{}');
    for (const invitation of invitations.invitations || (invitations.joinUrl ? [invitations] : [])) if (!invitation.joinPaused && invitation.invitePrompt) { if (invitation.joinUrl) log(invitation.joinUrl); log(invitation.invitePrompt); }
  } catch {}
  return true;
}
export async function revokeInstalledAgent(home: string) {
  const state = readAgentState(home);
  if (!state) return;
  if (state.credential) await request(state.baseUrl, '/api/agents/revoke', {}, state.credential);
  else if (state.requestId && state.pollingToken) {
    const response = await fetch(`${state.baseUrl}/api/agents/connect`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({requestId:state.requestId,pollingToken:state.pollingToken}), signal:AbortSignal.timeout(10000), redirect:'error' });
    if (!response.ok && response.status !== 403) throw new Error('Hive could not cancel this connection. Try uninstall again.');
  }
  unlinkSync(statePath(home));
}
export async function prepareHumanLogin(home: string, agents: Agent[]) {
  const state = readAgentState(home);
  if (!state) return;
  await revokeInstalledAgent(home);
  for (const agent of agents) {
    if (agent === 'claude') writeClaudeServer(home, `${state.baseUrl}/api/mcp`);
    else writeCodexServer(home, `${state.baseUrl}/api/mcp`);
  }
}
