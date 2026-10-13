import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository } from './session-start.mjs';
import { endpoint, homeDirectory } from './mcp.mjs';

export function captureContext(input = {}) {
  const cwd = input.cwd || process.cwd();
  let remote;
  let branch;
  try { remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  try { branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return { cwd, home: homeDirectory(), remote, repo: remote ? repository(remote) : undefined, branch, paths: [], agent: input.agent || 'claude-code', sessionType: input.session_type || process.env.CLAUDE_CODE_ENTRYPOINT || 'cli', sessionRef: input.session_id };
}

export async function effectiveCaptureRules({ token, baseUrl = endpoint(), home = homeDirectory(), now = Date.now(), signal = AbortSignal.timeout(1000) }) {
  const directory = join(home, '.hive', 'capture-cache');
  const cache = join(directory, createHash('sha256').update(`${baseUrl}:${token}`).digest('hex') + '.json');
  try {
    const value = JSON.parse(readFileSync(cache, 'utf8'));
    if (value.expiresAt > now && Array.isArray(value.rules)) return value.rules;
  } catch {}
  try {
    const response = await fetch(`${baseUrl}/api/app/capture-rules/effective`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal });
    if (!response.ok) return [];
    const value = await response.json();
    const rules = Array.isArray(value) ? value : value.rules;
    if (!Array.isArray(rules)) return [];
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(cache, JSON.stringify({ expiresAt: now + 30000, rules }), { mode: 0o600 });
    return rules;
  } catch { return []; }
}

export async function localCaptureDecision(rules, input) {
  const cheap = rules.filter(rule => rule.enabled && rule.action === 'drop' && rule.kind !== 'content_category');
  if (!cheap.length) return { dropped: false };
  let matchers;
  try { matchers = await import('./capture-matchers.mjs'); }
  catch { matchers = await import(pathToFileURL(new URL('../../../packages/core/src/capture-matchers.mjs', import.meta.url).pathname).href); }
  return matchers.evaluateCaptureRules(cheap, input);
}
