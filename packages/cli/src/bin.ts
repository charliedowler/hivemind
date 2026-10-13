#!/usr/bin/env node
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installExecutor, doctorExecutor, detectExecutor } from './executor.js';
import { install, uninstall, doctor, detectAgents, completeSignIn, completeAgentSignIn, type Agent } from './installer.js';
import { installerIdentity, displayName, knownInbox, type Identity } from './identity.js';

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Hive needs Node 20 or later');
  const args = process.argv.slice(2);
  const command = args.shift() || 'help';
  let home = process.env.HOME || homedir();
  let backupDir: string | undefined;
  let selectedAgent: Agent | undefined;
  let executorClient = false;
  let executorUrl: string | undefined;
  let yes = false;
  let identity: Identity | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--yes' || flag === '-y') yes = true;
    else if (flag === '--home' || flag === '--backup-dir' || flag === '--agent' || flag === '--client' || flag === '--executor-url' || flag === '--identity') {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--home') home = value;
      else if (flag === '--identity') {
        if (value !== 'human' && value !== 'agent') throw new Error('Choose human or agent for --identity');
        identity = value;
      }
      else if (flag === '--backup-dir') backupDir = resolve(value);
      else if (flag === '--executor-url') executorUrl = value;
      else if (flag === '--client' && value === 'executor') executorClient = true;
      else if (value === 'claude' || value === 'codex') selectedAgent = value;
      else throw new Error('Choose claude, codex or executor for --client');
    } else throw new Error(`Unknown option: ${flag}`);
  }
  home = resolve(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const agents = selectedAgent ? [selectedAgent] : detectAgents(home);
  if (executorClient && selectedAgent) throw new Error('Choose one client per --client install');
  const options = { home, agents, backupDir };
  const mode = installerIdentity(process.env, !yes && !!process.stdin.isTTY && !!process.stdout.isTTY, identity);
  const executorOptions = { home, endpoint: executorUrl };
  if (executorClient) {
    if (command === 'install') {
      if (agents.length) install({ ...options, registerMcp: false });
      installExecutor({ ...executorOptions, open: !yes && !!process.stdout.isTTY });
      await reportDoctor([{ agent: 'executor', healthy: doctorExecutor(executorOptions) }], home);
    } else if (command === 'doctor') {
      const healthy = doctorExecutor(executorOptions);
      await reportDoctor([{ agent: 'executor', healthy }], home);
      if (!healthy) process.exitCode = 1;
    }
    else if (command === 'uninstall') console.log('Remove the Hive integration in Executor only after checking who uses it. Local uninstall leaves organisation accounts and policies in place');
    else throw new Error('Use install, doctor or uninstall with --client executor');
    return;
  }
  if (command === 'install') {
    install(options);
    const signIn = (client: 'codex' | 'hooks', selectedHome: string, script: string) => {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: selectedHome, CODEX_HOME: join(selectedHome, '.codex'), HIVE_HOME: selectedHome };
      delete env.CLAUDE_CONFIG_DIR;
      if (mode === 'agent') {
        env.HIVE_IDENTITY = 'agent';
        env.HIVE_AGENT_NAME = displayName(process.env);
        const inbox = knownInbox(process.env, home);
        if (inbox) env.HIVE_AGENT_INBOX = inbox;
      }
      const result = client === 'codex'
        ? spawnSync('codex', ['mcp', 'login', 'hive'], { env, stdio: 'inherit', cwd: selectedHome, timeout: 120000 })
        : spawnSync(process.execPath, [script], { env, stdio: 'inherit', cwd: selectedHome, timeout: 130000 });
      return result.status ?? 1;
    };
    if (mode === 'agent' && !yes) {
      if (!completeAgentSignIn(options, signIn)) { process.exitCode = 1; return; }
    } else completeSignIn(options, !yes && !!process.stdin.isTTY && !!process.stdout.isTTY, signIn);
    const results: DoctorResult[] = [];
    doctor({ ...options, onDoctor: (agent, healthy) => results.push({ agent, healthy }) });
    await reportDoctor(results, home);
  } else if (command === 'doctor') {
    const results: DoctorResult[] = [];
    let healthy = doctor({ ...options, onDoctor: (agent, ready) => results.push({ agent, healthy: ready }) });
    if (detectExecutor(executorOptions).detected) {
      const ready = doctorExecutor(executorOptions);
      results.push({ agent: 'executor', healthy: ready });
      healthy &&= ready;
    }
    await reportDoctor(results, home);
    if (!healthy) process.exitCode = 1;
  } else if (command === 'uninstall') uninstall(options);
  else if (command === 'login') login(home, agents);
  else if (command === 'help' || command === '--help' || command === '-h') console.log('Bring your agent to the hive\n\ngohive install [--identity human|agent] [--yes] [--client claude|codex|executor]\ngohive doctor\ngohive login\ngohive uninstall\n\nAgent mode opens AgentID and waits up to two minutes per credential audience. Human mode keeps interactive sign-in. --yes installs without opening sign-in.\n\nOptions: --home <directory>, --backup-dir <directory>, --executor-url <MCP URL>');
  else throw new Error(`Unknown command: ${command}. Run gohive --help`);
}

type DoctorResult = { agent: Agent | 'executor'; healthy: boolean };

async function reportDoctor(results: DoctorResult[], home: string) {
  try {
    const telemetry = await import(new URL('../assets/hive/scripts/telemetry.mjs', import.meta.url).href);
    await telemetry.reportDoctors(results, home);
  } catch {}
}

function login(home: string, agents: Agent[]) {
  const directory = agents.includes('claude') ? '.claude' : '.codex';
  const result = spawnSync(process.execPath, [join(home, directory, 'skills/hive/scripts/login.mjs')], { stdio: 'inherit', env: { ...process.env, HOME: home, HIVE_HOME: home } });
  if (result.status !== 0) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof SyntaxError ? 'A configuration file contains invalid JSON. Fix it before retrying' : error.message); process.exitCode = 1; });
