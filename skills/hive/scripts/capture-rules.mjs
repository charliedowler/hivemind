import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository } from './session-start.mjs';
import { endpoint, homeDirectory } from './mcp.mjs';

let matchers;
try { matchers = await import('./capture-matchers.mjs'); }
catch { matchers = await import(pathToFileURL(new URL('../../../packages/core/src/capture-matchers.mjs', import.meta.url).pathname).href); }

let privacy;
try { privacy = await import('./capture-privacy.mjs'); }
catch { privacy = await import(pathToFileURL(new URL('../../../packages/core/src/capture-privacy.mjs', import.meta.url).pathname).href); }
export const gateCapturePrivacy = privacy.gateCapturePrivacy;

function samePath(left, right) {
  try { return fs.realpathSync(left) === fs.realpathSync(right); } catch { return path.resolve(left) === path.resolve(right); }
}

export function captureContext(input = {}) {
  const cwd = input.cwd || process.cwd();
  const home = homeDirectory();
  let remote;
  let branch;
  let root;
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  if (root && !samePath(root, home)) try { remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  try { branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  const repo = remote ? repository(remote) : undefined;
  remote = remote ? matchers.canonicalProject(remote) ?? undefined : undefined;
  return { cwd, home, remote, repo, branch, paths: [], agent: input.agent || 'claude-code', sessionType: input.session_type || process.env.CLAUDE_CODE_ENTRYPOINT || 'cli', sessionRef: input.session_id };
}

export async function effectiveCaptureRules({ token, baseUrl = endpoint(), signal = AbortSignal.timeout(1000) }) {
  try {
    const response = await fetch(`${baseUrl}/api/app/capture-rules/effective`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal });
    if (!response.ok) return null;
    const value = await response.json();
    if (!Array.isArray(value.rules) || !Array.isArray(value.policy?.include) || !Array.isArray(value.policy?.exclude) || !Number.isSafeInteger(value.policy.revision)) return null;
    return value;
  } catch { return null; }
}

export async function localCaptureDecision(effective, input) {
  const policy = matchers.evaluateProjectPolicy(effective?.policy, input);
  if (!policy.allowed) return {dropped: true, action: 'drop', reason: policy.reason};
  const cheap = effective.rules.filter(rule => rule.enabled && rule.action === 'drop' && rule.kind !== 'content_category');
  return matchers.evaluateCaptureRules(cheap, input);
}
