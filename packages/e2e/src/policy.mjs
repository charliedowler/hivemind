import assert from 'node:assert/strict';
import { outputViolations } from './guards.mjs';

export function installerProtocol(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  assert.ok(match, `Invalid installer version: ${version}`);
  return Number(match[1]) === 0 && Number(match[2]) < 2 ? 'oauth' : 'bootstrap';
}

export function selectedClient(env = {}) {
  if (env.CLAUDECODE) return 'claude';
  if (Object.entries(env).some(([key, value]) => key.startsWith('CODEX_') && key !== 'CODEX_HOME' && value)) return 'codex';
  return null;
}

export function installationDecision({ installed, authenticated, refusedMinimumReleaseAge = false }) {
  if (refusedMinimumReleaseAge) return { action: 'blocked', reason: 'Package release age policy refused installation' };
  if (installed && authenticated) return { action: 'reuse' };
  return { action: installed ? 'authenticate' : 'install' };
}

export function assertHumanOutput(text, { missingDetail = false } = {}) {
  assert.deepEqual(outputViolations(text), [], `Human-facing output violates the contract: ${text}`);
  if (missingDetail) assert.equal((text.match(/\?/g) || []).length, 1, 'Ask exactly one question for the missing detail');
}

export function readPolicy(agentText, skillText, version) {
  assert.ok(agentText.trim().length > 100, '/agent must provide setup instructions');
  assert.ok(skillText.trim().length > 100, 'Installed skill must provide instructions');
  for (const tool of ['hive_share_projects', 'hive_push']) assert.ok(agentText.includes(tool) && skillText.includes(tool), `Setup and installed skill must both explain ${tool}`);
  assert.ok(agentText.includes('--join-url') || agentText.includes('hive_join'), 'Setup must explain the join entry point');
  assert.match(agentText, /capture nothing/i);
  assert.ok(agentText.includes(workAreasQuestion) && skillText.includes(workAreasQuestion), 'Setup and installed skill must both ask the work-areas question');
  assert.match(agentText, /(?:skip|reuse|already installed)/i);
  return {
    protocol: installerProtocol(version),
    tools: [...new Set([...agentText.matchAll(/\bhive_[a-z_]+\b/g), ...skillText.matchAll(/\bhive_[a-z_]+\b/g)].map(match => match[0]))],
    agentText,
    skillText,
  };
}

export async function loadPolicy(ctx, machine) {
  const response = await ctx.request('/agent', { headers: { accept: 'text/markdown' } });
  assert.equal(response.status, 200, '/agent must load over the real local HTTP service');
  const skillText = await machine.read(`${machine.client === 'claude' ? '.claude' : '.codex'}/skills/hive/SKILL.md`);
  const policy = readPolicy(response.text, skillText, await machine.installerVersion());
  await ctx.artifact('policy.json', policy);
  return policy;
}

export const workAreasQuestion = 'What kinds of things do you work on that Hive can learn from? Type a few areas, or skip.';

export async function applyProjectAnswer(ctx, { token, projects, workAreas, policy, humanInstruction }) {
  assert.ok(policy.tools.includes('hive_share_projects'));
  const current = await ctx.mcp(token, 'hive_share_projects', { revision: 0 });
  assert.equal(current.isError, false, current.text);
  assert.ok(current.value && Number.isInteger(current.value.revision), 'Read must return the real policy revision');
  assert.ok(['everything', 'selected'].includes(current.value.mode), 'Read must return the capture mode');
  if (projects === undefined && workAreas === undefined) return current.value.workAreas ? { state: 'existing', value: current.value } : { state: 'question', question: workAreasQuestion };
  if (!projects?.length && !workAreas) return { state: 'default', value: current.value };
  assert.equal(typeof humanInstruction, 'string', 'A saved answer requires the fixture human answer');
  const saved = await ctx.mcp(token, 'hive_share_projects', { ...(projects?.length ? { mode: 'selected', include: projects, exclude: [] } : {}), ...(workAreas ? { workAreas } : {}), revision: current.value.revision, humanInstruction });
  assert.equal(saved.isError, false, saved.text);
  if (projects?.length) assert.deepEqual(saved.value.include, projects);
  if (workAreas) assert.equal(saved.value.workAreas, workAreas);
  return { state: 'saved', value: saved.value };
}

export async function authenticateByVersion(ctx, machine, { email, onOAuth, onClaim, extra = {} } = {}) {
  const protocol = installerProtocol(await machine.installerVersion());
  if (protocol === 'oauth') {
    assert.equal(typeof onOAuth, 'function', 'Legacy installer requires the real local OAuth/PKCE callback; bootstrap is not a fallback');
    return onOAuth({ ctx, machine });
  }
  if (!email) return { state: 'question', question: 'What email should Hive use?' };
  const result = await ctx.bootstrap(email, extra);
  if (result.status === 'link_sent') {
    assert.equal(typeof onClaim, 'function', 'Existing owner connection requires a local mail-claim callback');
    await onClaim({ ctx, machine, email, result });
    const polled = await ctx.request('/api/agents/connect', { method: 'POST', body: { requestId: result.requestId, pollingToken: result.pollingToken } });
    assert.equal(polled.status, 200);
    assert.equal(polled.body.status, 'issued');
    return polled.body;
  }
  assert.equal(result.status, 'issued');
  return result;
}

export function realPrompt({ url, email, projects, share = 'Not now', joinUrl, teamName, fix = false, existing = false, missingDetail = false }) {
  if (joinUrl) assert.ok(teamName, 'Join prompt must include a human-supplied team name');
  const lines = [
    joinUrl ? `Set me up on Hive and join the ${teamName} hive: read ${url}/agent and follow it, then join with ${joinUrl}` : `Set me up on Hive: read ${url}/agent and follow it.`,
    'This is an isolated local acceptance test. Read the local page using curl.',
    'Use the installed npx wrapper for gohive; it executes the locally built installer. Do not fetch packages or access a production Hive server.',
    'All Hive HTTP and MCP requests must use HIVE_URL. If the product ignores that URL, report the blocker and stop.',
    'Use the native MCP tools and installed Hive skill. Do not call bootstrap or write credentials/configuration yourself as a workaround.',
    'A human is present and has authorised setup. Use the preanswers below without asking again. A local test driver completes any claim email or OAuth page.',
  ];
  if (existing) lines.push('This owner already exists. Reuse the account and its capture settings; do not create a second person.');
  if (email && !missingDetail) lines.push(`My email is ${email}.`);
  if (projects !== undefined) lines.push(`Project answer: ${projects.length ? `Hive may learn from ${projects.join(', ')} only.` : 'Leave this repo out of Hive. Do not capture anything from it.'}`);
  lines.push('Work areas answer: skip.');
  if (joinUrl) {
    lines.push(`Organisation sharing answer: ${share}.`);
  }
  if (missingDetail) lines.push('One necessary setup detail has intentionally not been supplied. Ask one concise question for the missing detail, then stop. Do not invent an address or use a machine account.');
  if (fix) lines.push('After setup, run npm test in this project as a standalone Bash command exactly "npm test", with no pipes, redirects, chaining or extra commands. Inspect the failure, create fixed.txt to initialise the fixture cache in a separate tool call, then run the exact standalone "npm test" again. This is necessary to exercise the installed native fail-to-pass hook matcher. Capture the observed cause, fix and test evidence only if Hive may learn from this project. Do not run any other project or touch files outside this scratch machine.');
  lines.push('Finish with a short plain-English result or the single genuine blocker. Do not ask for confirmation of an already supplied answer.');
  return lines.join('\n');
}
