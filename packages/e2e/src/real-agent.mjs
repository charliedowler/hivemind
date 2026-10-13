import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

export const requiredVersions = { claude: '2.1.296', codex: '0.162.1' };
const budgets = new Map();
const codexDisabledFeatures = ['apps', 'plugins', 'remote_plugin', 'enable_mcp_apps', 'skill_mcp_dependency_install'];
const codexDisableArgs = codexDisabledFeatures.flatMap(feature => ['--disable', feature]);

export function parseAgentEvents(text) {
  return text.split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line); } catch { return { type: 'non-json-output', text: line }; }
  });
}

export function agentEvidence(client, events) {
  const text = [];
  const tools = [];
  const hooks = [];
  let turns = 0;
  const results = new Map();
  const messageIds = new Set();
  for (const event of events) {
    if (client === 'claude') {
      if (event.type === 'assistant') {
        messageIds.add(event.message?.id || event.uuid);
        turns = messageIds.size;
        for (const block of event.message?.content || []) {
          if (block.type === 'text') text.push(block.text);
          if (block.type === 'tool_use') tools.push({ name: block.name, input: block.input, id: block.id });
        }
      }
      if (event.type === 'user') for (const block of event.message?.content || []) if (block.type === 'tool_result') results.set(block.tool_use_id, { content: block.content, isError: Boolean(block.is_error), native: event.tool_use_result });
      if (/hook/.test(event.subtype || event.type)) hooks.push(event);
      if (event.type === 'result' && event.result && !text.includes(event.result)) text.push(event.result);
    } else {
      if (event.type === 'turn.started') turns++;
      const item = event.item;
      if (event.type !== 'item.completed' || !item) continue;
      if (item.type === 'agent_message') text.push(item.text);
      if (item.type === 'command_execution') tools.push({ name: 'shell', command: item.command, exitCode: item.exit_code, output: item.aggregated_output });
      if (item.type === 'mcp_tool_call') tools.push({ name: `mcp__${item.server}__${item.tool}`, input: item.arguments, result: item.result, error: item.error });
    }
  }
  for (const tool of tools) if (results.has(tool.id)) tool.result = results.get(tool.id);
  return { text: text.join('\n'), tools, hooks, turns };
}

export async function runRealAgent(machine, options = {}) {
  assert.equal(machine.mode, 'real', 'Real agent runs require an authenticated isolated machine');
  const { client } = machine;
  const executable = machine.executables[client];
  const maxTurns = Math.min(options.maxTurns || 12, 16);
  const maxToolCalls = Math.min(options.maxToolCalls || 28, 40);
  const timeoutMs = Math.min(options.timeoutMs || 180000, 240000);
  const budgetKey = options.budgetKey || machine.url;
  const runs = budgets.get(budgetKey) || 0;
  assert.ok(runs < 12, 'Real matrix is capped at twelve agent invocations per local server');
  budgets.set(budgetKey, runs + 1);
  const artifact = options.artifact || (async () => {});
  const sandbox = await machine.prepareSandbox();
  await artifact('sandbox.json', { platform: process.platform, writableRoot: machine.root, providerHosts: sandbox.providerHosts, proxyUrl: sandbox.proxyUrl });
  const version = await machine.exec(executable, ['--version'], { sandbox: true });
  assert.equal(version.status, 0, machine.redact(version.stderr));
  const actualVersion = version.stdout.match(/\d+\.\d+\.\d+/)?.[0];
  assert.ok(actualVersion, `Cannot read the ${client} CLI version`);
  const help = await machine.exec(executable, client === 'claude' ? ['--help'] : ['exec', '--help'], { sandbox: true });
  assert.equal(help.status, 0);
  for (const flag of client === 'claude' ? ['--output-format', '--include-hook-events', '--max-budget-usd'] : ['--json', '--ephemeral', '--cd']) assert.ok(help.stdout.includes(flag), `Installed ${client} lacks ${flag}`);
  if (!machine.options.localConfigOverride) await machine.assertLocalInstaller();
  await artifact('cli-provenance.json', { client, version: version.stdout.trim(), authSource: machine.authSource, timeoutMs, maxTurns, maxToolCalls, maxBudgetUsd: client === 'claude' ? 2 : null });
  await artifact('cli-help.txt', help.stdout);
  if (client === 'codex') {
    const features = await machine.exec(executable, [...codexDisableArgs, 'features', 'list'], { sandbox: true });
    assert.equal(features.status, 0, machine.redact(features.stderr));
    const effective = Object.fromEntries(features.stdout.trim().split('\n').map(line => [line.trim().split(/\s+/)[0], line.trim().split(/\s+/).at(-1)]));
    for (const feature of codexDisabledFeatures) assert.equal(effective[feature], 'false', `Codex ${feature} must be effectively disabled before model startup`);
    const inventory = await machine.exec(executable, [...codexDisableArgs, 'mcp', 'list', '--json'], { sandbox: true });
    assert.equal(inventory.status, 0, machine.redact(inventory.stderr));
    const servers = JSON.parse(inventory.stdout);
    assert.ok(Array.isArray(servers));
    for (const server of servers) {
      assert.equal(server.name, 'hive', 'Only the local native Hive MCP server may be configured');
      assert.equal(server.transport?.url, `${machine.url}/api/mcp`, 'Native Codex MCP must target the local server');
    }
    await artifact('codex-isolation-preflight.json', { effectiveFeatures: Object.fromEntries(codexDisabledFeatures.map(feature => [feature, effective[feature]])), servers: machine.redact(servers) });
  }
  const nativeConfig = client === 'claude' ? (existsSync(machine.path('.claude.json')) ? machine.path('.claude.json') : await machine.write('.hive/empty-mcp.json', { mcpServers: {} })) : undefined;
  if (client === 'claude') {
    const { readFile } = await import('node:fs/promises');
    const servers = JSON.parse(await readFile(nativeConfig, 'utf8')).mcpServers || {};
    for (const [name, server] of Object.entries(servers)) {
      assert.equal(name, 'hive', 'Claude strict MCP config must contain only Hive');
      assert.equal(server.url, `${machine.url}/api/mcp`, 'Claude native MCP URL must be local');
    }
    await artifact('claude-isolation-preflight.json', { strictMcpConfig: true, servers: machine.redact(servers) });
  }
  const args = client === 'claude'
    ? ['-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--no-chrome', '--dangerously-skip-permissions', '--strict-mcp-config', '--mcp-config', nativeConfig, '--setting-sources', 'user,project,local', '--max-budget-usd', '2', ...(options.model ? ['--model', options.model] : [])]
    : ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--ignore-rules', ...codexDisableArgs, '--cd', machine.cwd, '-c', 'cli_auth_credentials_store="file"', ...(options.model ? ['--model', options.model] : []), '-'];
  let buffered = '';
  const events = [];
  let assistantTurns = 0, toolCalls = 0;
  const messages = new Set();
  const toolIds = new Set();
  const callbacks = [];
  const accept = line => {
    if (!line.trim()) return;
    const event = parseAgentEvents(line)[0];
    events.push(event);
    if (client === 'claude' && event.type === 'system' && event.subtype === 'init') for (const server of event.mcp_servers || []) assert.equal(server.name, 'hive', 'Claude initial tool inventory must contain only the local Hive server');
    if (client === 'codex' && event.item?.type === 'mcp_tool_call' && event.item.server !== 'hive') throw new Error(`Codex exposed a nonlocal MCP server: ${event.item.server}`);
    if (client === 'claude' && event.type === 'assistant') {
      messages.add(event.message?.id || event.uuid);
      assistantTurns = messages.size;
      for (const block of event.message?.content || []) if (block.type === 'tool_use') toolIds.add(block.id);
      toolCalls = toolIds.size;
    }
    if (client === 'codex' && event.type === 'item.started' && ['command_execution', 'mcp_tool_call'].includes(event.item?.type)) toolCalls++;
    if (client === 'codex' && event.type === 'turn.started') assistantTurns++;
    if (assistantTurns > maxTurns || toolCalls > maxToolCalls) throw new Error(`Real ${client} exceeded its turn/tool budget`);
    if (options.onEvent) callbacks.push(Promise.resolve(options.onEvent(machine.redact(event), machine)));
  };
  let result, error;
  const beforeAgent = options.beforeAgent || machine.options.beforeAgent;
  const afterAgent = options.afterAgent || machine.options.afterAgent;
  let supervision;
  try {
    supervision = await beforeAgent?.(machine, { client, signal: options.signal || machine.options.signal });
    result = await machine.exec(executable, args, {
      input: options.prompt,
      signal: options.signal,
      timeoutMs,
      sandbox: true,
      onStdout(chunk) {
        buffered += chunk;
        const lines = buffered.split('\n');
        buffered = lines.pop();
        lines.forEach(accept);
      },
    });
    if (buffered.trim()) accept(buffered);
    await Promise.all(callbacks);
    assert.ok(events.length, `${client} emitted no JSON events`);
    const terminal = events.findLast(event => event.type === 'result' || event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'error');
    assert.ok(terminal, `${client} did not complete its turn`);
    const terminalMessage = terminal.result || terminal.message || terminal.error?.message || '';
    if (terminal.api_error_status === 401 || /OAuth token revoked|failed to authenticate|refresh token.*(?:expired|revoked)|invalid.*authentication/i.test(terminalMessage)) {
      const blocked = new Error(`External ${client} authentication blocked: ${machine.redact(terminalMessage)}`);
      blocked.code = 'E2E_BLOCKED';
      blocked.blocked = true;
      throw blocked;
    }
    assert.equal(result.status, 0, `Real ${client} failed: ${machine.redact(terminalMessage || result.stderr)}`);
    assert.ok(!terminal.is_error && !['turn.failed', 'error'].includes(terminal.type), `${client} reported a failed turn: ${JSON.stringify(machine.redact(terminal))}`);
  } catch (caught) { error = caught; result ||= caught.result; }
  finally {
    try {
      if (typeof supervision === 'function') await supervision();
      else await supervision?.stop?.();
      await afterAgent?.(machine, { events: machine.redact(events), result: machine.redact(result), error });
    } finally {
      await artifact('agent-events.jsonl', events.map(event => JSON.stringify(machine.redact(event))).join('\n'));
      await artifact('agent-process.json', machine.redact(result || { error: error?.message }));
      await artifact('machine-calls.json', machine.redact(await machine.calls()));
    }
  }
  if (error) throw error;
  const evidence = agentEvidence(client, events);
  await artifact('agent-evidence.json', machine.redact(evidence));
  return { ...evidence, events, result };
}
