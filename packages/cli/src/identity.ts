import { hostname } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Identity = 'human' | 'agent';
export function harness(env: NodeJS.ProcessEnv): 'Claude Code' | 'Codex' | undefined {
  if (env.CLAUDECODE) return 'Claude Code';
  if (Object.entries(env).some(([key, value]) => key.startsWith('CODEX_') && key !== 'CODEX_HOME' && !!value)) return 'Codex';
}

export function installerIdentity(env: NodeJS.ProcessEnv, _humanTerminal: boolean, explicit?: Identity, headless = false): Identity {
  const enabled = (value?: string) => !!value && !/^(?:0|false|no)$/i.test(value);
  return explicit ?? (headless || enabled(env.CI) || enabled(env.HIVE_HEADLESS) || enabled(env.HIVE_NO_HUMAN) ? 'agent' : 'human');
}

export function displayName(env: NodeJS.ProcessEnv, host = hostname()): string {
  const clean = (value: string) => value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/[^\p{L}\p{N} ._()-]/gu, '').replace(/\s+/g, ' ').trim();
  return clean(`${harness(env) || 'Coding agent'} on ${clean(host) || 'this computer'}`).slice(0, 80).trim();
}

export function knownInbox(env: NodeJS.ProcessEnv, home: string): string | undefined {
  const valid = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) && value.length <= 254 ? value.toLowerCase() : undefined;
  for (const key of ['AGENTMAIL_INBOX_ID', 'AGENTMAIL_INBOX', 'AGENTMAIL_INBOX_EMAIL', 'AGENTMAIL_EMAIL']) {
    const value = valid(env[key]);
    if (value) return value;
  }
  for (const file of [join(home, '.config/agentmail/config.json'), join(home, '.agentmail/config.json')]) {
    try {
      if (!existsSync(file)) continue;
      const value = JSON.parse(readFileSync(file, 'utf8'));
      const inbox = valid(value.inbox_id ?? value.inboxId ?? value.inbox_email);
      if (inbox) return inbox;
    } catch {}
  }
}

