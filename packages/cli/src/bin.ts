#!/usr/bin/env node
import { homedir } from 'node:os';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installExecutor, doctorExecutor, detectExecutor, reportExecutorDetection, offerExecutor, declineExecutor, executorState } from './executor.js';
import { install, uninstall, doctor, selectAgents, installedAgents, parseClients, updateInstall, type Agent } from './installer.js';
import { harness } from './identity.js';
import { bootstrap, bootstrapStatus, readAgentState, detectedEmail, emailQuestion, revokeInstalledAgent, prepareHumanLogin } from './bootstrap.js';
import { beginSignIn, status, joinPhrase } from './onboarding.js';

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Hive needs Node 20 or later');
  const args = process.argv.slice(2);
  const command = args.shift() || 'help';
  const updating = command === 'install' && args.includes('--update');
  if (!updating && ['install', 'login', 'status'].includes(command)) console.log(`gohive ${JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version}`);
  let home = process.env.HOME || homedir();
  let backupDir: string | undefined;
  let selectedAgents: Agent[] | undefined;
  let executorClient = false;
  let executorUrl: string | undefined;
  let skipExecutor = false;
  let dryRun = false;
  let email: string | undefined;
  let phrase: string | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--update' && command === 'install') continue;
    if (flag === '--yes' || flag === '-y') continue;
    else if (flag === '--skip-executor') skipExecutor = true;
    else if (flag === '--dry-run') dryRun = true;
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
  if (dryRun && !(executorClient && command === 'install')) throw new Error('--dry-run is for install --client executor');
  if (updating) { updateInstall({ home, backupDir }); return; }
  if (command === 'status') {
    const updates = await import(new URL('../assets/hive/scripts/auto-update.mjs', import.meta.url).href);
    const notice = await updates.checkForUpdate({ home });
    if (notice) console.log(notice);
  }
  const agents = executorClient ? [] : command === 'install' ? selectAgents(home, process.env, selectedAgents) : selectedAgents || installedAgents(home) || selectAgents(home);
  if (executorClient && selectedAgents) throw new Error('Choose one client per --client install');
  const options = { home, agents, backupDir, terminalDetection: command === 'install' && !executorClient && !selectedAgents && !harness(process.env) };
  const executorOptions = { home, endpoint: executorUrl, dryRun };
  const executorDetection = detectExecutor(executorOptions);
  if (['install', 'status'].includes(command)) reportExecutorDetection(executorDetection);
  if (command === 'install' && !executorClient) {
    if (skipExecutor) declineExecutor(home);
    const offer = offerExecutor(executorOptions, executorDetection);
    if (offer) { console.log(JSON.stringify(offer)); return; }
  }
  if (executorClient) {
    if (command === 'install') {
      if (!dryRun) install({ ...options, registerMcp: false, executor: true });
      console.log(JSON.stringify(installExecutor(executorOptions)));
    } else if (command === 'doctor') {
      const healthy = doctorExecutor(executorOptions);
      await reportDoctor([{ agent: 'executor', healthy }], home);
      if (!healthy) process.exitCode = 1;
    }
    else if (command === 'status') { doctorExecutor(executorOptions); }
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
    if (executorDetection.detected || executorState(home).setup) doctorExecutor(executorOptions);
    if (readAgentState(home)) await bootstrapStatus(home);
    else if (!executorState(home).setup || installedAgents(home)?.length) {
      if (!installedAgents(home)) console.log('Not installed. Ask me to set up Hive when you want to connect.');
      else if (!status(home, phrase)) process.exitCode = 1;
    }
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
  else if (command === 'help' || command === '--help' || command === '-h') console.log('Bring your agent to the hive\n\ngohive install [--email <address>] [--join-url <Hive link>] [--client claude|codex|all|claude,codex|executor]\ngohive install --client executor [--dry-run]\ngohive install --update\ngohive status\ngohive doctor\ngohive login\ngohive uninstall\n\nInstall offers Executor once when detected. --skip-executor records Not now. Executor uses human OAuth through a connection link, without an email or bootstrap credential. Other clients ask which email to use, then create an agent connection with no browser. Claim your account with the email link. Harness markers select only the current client. Without markers, install configures the detected clients. Use gohive login to sign in as a person with OAuth. Status checks for a silent background update of an existing install and never opens a browser. Uninstall revokes this machine’s agent credential.\n\nOptions: --home <directory>, --backup-dir <directory>, --executor-url <MCP URL>');
  else throw new Error(`Unknown command: ${command}. Run gohive --help`);
}

type DoctorResult = { agent: Agent | 'executor'; healthy: boolean };

async function reportDoctor(results: DoctorResult[], home: string) {
  try {
    const telemetry = await import(new URL('../assets/hive/scripts/telemetry.mjs', import.meta.url).href);
    await telemetry.reportDoctors(results, home);
  } catch {}
}

const unreachable = (error: unknown) => error instanceof TypeError && /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|network/i.test(String((error as Error).message) + String((error as { cause?: { code?: string } }).cause?.code ?? ''))
  || (error instanceof Error && /could not complete|Bad gateway|HTTP 5\d\d/i.test(error.message));
main().catch(error => {
  console.error(error instanceof SyntaxError ? 'A configuration file contains invalid JSON. Fix it before retrying'
    : unreachable(error) ? 'Hive is unreachable right now. Your install and sign-in are untouched; continue without Hive and run npx gohive status later.'
    : error.message);
  process.exitCode = 1;
});
