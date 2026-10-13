#!/usr/bin/env node
import { homedir } from 'node:os';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installExecutorBearer, doctorExecutor, detectExecutor } from './executor.js';
import { install, uninstall, doctor, selectAgents, installedAgents, parseClients, type Agent } from './installer.js';
import { harness } from './identity.js';
import { bootstrap, bootstrapStatus, readAgentState, detectedEmail, emailQuestion, revokeInstalledAgent, prepareHumanLogin } from './bootstrap.js';
import { beginSignIn, status, joinPhrase } from './onboarding.js';

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Hive needs Node 20 or later');
  const args = process.argv.slice(2);
  const command = args.shift() || 'help';
  if (['install', 'login', 'status'].includes(command)) console.log(`gohive ${JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version}`);
  let home = process.env.HOME || homedir();
  let backupDir: string | undefined;
  let selectedAgents: Agent[] | undefined;
  let executorClient = false;
  let executorUrl: string | undefined;
  let yes = false;
  let email: string | undefined;
  let phrase: string | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--yes' || flag === '-y') yes = true;
    else if (flag === '--home' || flag === '--backup-dir' || flag === '--agent' || flag === '--client' || flag === '--executor-url' || flag === '--email' || flag === '--join-url') {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--home') home = value;
      else if (flag === '--join-url') phrase = joinPhrase(value);
      else if (flag === '--email') email = value;
      else if (flag === '--backup-dir') backupDir = resolve(value);
      else if (flag === '--executor-url') executorUrl = value;
      else if (flag === '--client' && value === 'executor') executorClient = true;
      else selectedAgents = parseClients(value);
    } else throw new Error(`Unknown option: ${flag}`);
  }
  home = resolve(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const agents = executorClient ? [] : command === 'install' ? selectAgents(home, process.env, selectedAgents) : selectedAgents || installedAgents(home) || selectAgents(home);
  if (executorClient && selectedAgents) throw new Error('Choose one client per --client install');
  const options = { home, agents, backupDir, terminalDetection: command === 'install' && !executorClient && !selectedAgents && !harness(process.env) };
  const executorOptions = { home, endpoint: executorUrl };
  if (executorClient) {
    if (command === 'install') {
      if (!email && !readAgentState(home)) { console.log(JSON.stringify(emailQuestion(detectedEmail()))); return; }
      install({ ...options, registerMcp: false, executor: true });
      const state = await bootstrap({ home, agents, email: email || '', phrase, executor: true });
      await bootstrapStatus(home, { announcement: true });
      if (!state.credential) return;
      await reportDoctor([{ agent: 'executor', healthy: doctorExecutor(executorOptions) }], home);
    } else if (command === 'doctor') {
      const healthy = doctorExecutor(executorOptions);
      await reportDoctor([{ agent: 'executor', healthy }], home);
      if (!healthy) process.exitCode = 1;
    }
    else if (command === 'status') { await bootstrapStatus(home); }
    else if (command === 'uninstall') { await revokeInstalledAgent(home); console.log('Remove the Hive integration in Executor only after checking who uses it. Local uninstall leaves organisation accounts and policies in place'); }
    else throw new Error('Use install, doctor or uninstall with --client executor');
    return;
  }
  if (command === 'install') {
    if (!email && !readAgentState(home)) { console.log(JSON.stringify(emailQuestion(detectedEmail()))); return; }
    install({ ...options, registerMcp: false });
    await bootstrap({ home, agents, email: email || '', phrase });
    await bootstrapStatus(home, { announcement: true });
  } else if (command === 'status') {
    if (readAgentState(home)) await bootstrapStatus(home);
    else if (!installedAgents(home)) console.log('Not installed. Ask me to set up Hive when you want to connect.');
    else if (!status(home, phrase)) process.exitCode = 1;
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
  } else if (command === 'uninstall') { await revokeInstalledAgent(home); uninstall(options); }
  else if (command === 'login') {
    await prepareHumanLogin(home, agents);
    if (!installedAgents(home)) install(options);
    await beginSignIn({ home, agents, identity: 'human', phrase, force: true });
  }
  else if (command === 'help' || command === '--help' || command === '-h') console.log('Bring your agent to the hive\n\ngohive install [--email <address>] [--join-url <Hive link>] [--client claude|codex|all|claude,codex|executor]\ngohive status\ngohive doctor\ngohive login\ngohive uninstall\n\nInstall asks which email to use, then creates an agent connection with no browser. Claim your account with the email link. Harness markers select only the current client. Without markers, install configures the detected clients. Use gohive login to sign in as a person with OAuth. Status never installs or opens a browser. Uninstall revokes this machine’s agent credential.\n\nOptions: --home <directory>, --backup-dir <directory>, --executor-url <MCP URL>');
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
