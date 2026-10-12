import { randomUUID } from 'node:crypto';
import { bearerToken, endpoint, homeDirectory } from './mcp.mjs';

export async function reportEvent(kind, input, { home = homeDirectory(), baseUrl = endpoint(), token, signal = AbortSignal.timeout(1000) } = {}) {
  if (process.env.HIVE_TELEMETRY === '0') return false;
  try {
    token ||= await bearerToken(home, baseUrl, signal);
    if (!token) return false;
    const body = kind === 'install'
      ? { attemptId: input.attemptId || randomUUID(), step: input.step, outcome: input.outcome, agent: input.agent, platform: input.platform }
      : { attemptId: input.attemptId || randomUUID(), hookKind: input.hookKind, gateDecision: input.gateDecision, pushedCount: input.pushedCount ?? null };
    const response = await fetch(`${baseUrl}/api/analytics/${kind}`, {
      method: 'POST', signal, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await response.body?.cancel();
    return response.status === 204;
  } catch { return false; }
}

export async function reportDoctors(results, home = homeDirectory()) {
  if (process.env.HIVE_TELEMETRY === '0') return [];
  const signal = AbortSignal.timeout(2000);
  const token = await bearerToken(home, endpoint(), signal);
  if (!token) return [];
  const platform = ['darwin', 'linux', 'win32'].includes(process.platform) ? process.platform : 'unknown';
  return Promise.all(results.map(({ agent, healthy }) => reportEvent('install', {
    step: 'doctor', outcome: healthy ? 'completed' : 'failed', agent: agent === 'claude' ? 'claude-code' : agent, platform,
  }, { home, token, signal })));
}
