import { hostname } from 'node:os';

export type Identity = 'human' | 'agent';
export function harness(env: NodeJS.ProcessEnv): 'Claude Code' | 'Codex' | undefined {
  if (env.CLAUDECODE) return 'Claude Code';
  if (Object.entries(env).some(([key, value]) => key.startsWith('CODEX_') && key !== 'CODEX_HOME' && !!value)) return 'Codex';
}

export function installerIdentity(_env: NodeJS.ProcessEnv, _humanTerminal: boolean, explicit?: Identity, headless = false): Identity {
  return explicit ?? (headless ? 'agent' : 'human');
}

export function displayName(env: NodeJS.ProcessEnv, host = hostname()): string {
  const clean = (value: string) => value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/[^\p{L}\p{N} ._()-]/gu, '').replace(/\s+/g, ' ').trim();
  return clean(`${harness(env) || 'Coding agent'} on ${clean(host) || 'this computer'}`).slice(0, 80).trim();
}

