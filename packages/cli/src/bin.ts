#!/usr/bin/env node
import { homedir } from 'node:os';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installExecutor, doctorExecutor, detectExecutor } from './executor.js';
import { install, uninstall, doctor, detectAgents, type Agent } from './installer.js';
import { installerIdentity, harness, type Identity } from './identity.js';
import { beginSignIn, status, joinPhrase } from './onboarding.js';

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Hive needs Node 20 or later');
  const args = process.argv.slice(2);
  const command = args.shift() || 'help';
  if (command === 'install' || command === 'login') console.log(`gohive ${JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version}`);
  let home = process.env.HOME || homedir();
  let backupDir: string | undefined;
  let selectedAgent: Agent | undefined;
  let executorClient = false;
  let executorUrl: string | undefined;
  let yes = false;
  let identity: Identity | undefined;
  let headless = false;
  let phrase: string | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--yes' || flag === '-y') yes = true;
    else if (flag === '--headless') headless = true;
    else if (flag === '--home' || flag === '--backup-dir' || flag === '--agent' || flag === '--client' || flag === '--executor-url' || flag === '--identity' || flag === '--join-url') {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--home') home = value;
      else if (flag === '--join-url') phrase = joinPhrase(value);
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
  const mode = installerIdentity(process.env, !!process.stdin.isTTY && !!process.stdout.isTTY, identity, headless);
  if (mode === 'agent' && harness(process.env) && identity !== 'agent') throw new Error('An interactive coding harness needs human sign-in. Use --identity human, or explicitly --identity agent for an agent.');
  const executorOptions = { home, endpoint: executorUrl };
  if (executorClient) {
    if (command === 'install') {
      install({ ...options, registerMcp: false, executor: true });
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
    if (!yes) await beginSignIn({ home, agents, identity: mode, headless, phrase });
    else console.log('Hive is installed. Run gohive login, then gohive status.');
  } else if (command === 'status') {
    if (!status(home, phrase)) process.exitCode = 1;
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
  else if (command === 'login') await beginSignIn({ home, agents, identity: mode, headless, phrase, force: true });
  else if (command === 'help' || command === '--help' || command === '-h') console.log('Bring your agent to the hive\n\ngohive install [--identity human|agent] [--headless] [--join-url <Hive link>] [--yes] [--client claude|codex|executor]\ngohive status\ngohive doctor\ngohive login\ngohive uninstall\n\nA person signs in as themselves with Google or Slack. Harness markers do not select agent identity. Use --identity agent or --headless when no human is present. Sign-in runs in the background; status resumes it. --yes installs without opening sign-in.\n\nOptions: --home <directory>, --backup-dir <directory>, --executor-url <MCP URL>');
  else throw new Error(`Unknown command: ${command}. Run gohive --help`);
}

type DoctorResult = { agent: Agent | 'executor'; healthy: boolean };

async function reportDoctor(results: DoctorResult[], home: string) {
  try {
    const telemetry = await import(new URL('../assets/hive/scripts/telemetry.mjs', import.meta.url).href);
    await telemetry.reportDoctors(results, home);
  } catch {}
}

main().catch(error => { console.error(error instanceof SyntaxError ? 'A configuration file contains invalid JSON. Fix it before retrying' : error.message); process.exitCode = 1; });
