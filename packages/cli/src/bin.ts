#!/usr/bin/env node
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { install, uninstall, doctor, detectAgents, type Agent } from './installer.js';

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Hive needs Node 20 or later');
  const args = process.argv.slice(2);
  const command = args.shift() || 'help';
  let home = process.env.HOME || homedir();
  let backupDir: string | undefined;
  let selectedAgent: Agent | undefined;
  let yes = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--yes' || flag === '-y') yes = true;
    else if (flag === '--home' || flag === '--backup-dir' || flag === '--agent') {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--home') home = value;
      else if (flag === '--backup-dir') backupDir = resolve(value);
      else if (value === 'claude' || value === 'codex') selectedAgent = value;
      else throw new Error('Choose claude or codex for --agent');
    } else throw new Error(`Unknown option: ${flag}`);
  }
  home = resolve(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const agents = selectedAgent ? [selectedAgent] : detectAgents(home);
  const options = { home, agents, backupDir };
  if (command === 'install') {
    install(options);
    console.log('A little memory goes a long way. Your skill and hooks are in place');
    if (agents.includes('codex')) console.log('Sign in to Codex: codex mcp login hive');
    if (agents.includes('claude')) console.log('Sign in to Claude Code: run claude, then open /mcp and authenticate hive');
    if (agents.includes('claude')) console.log('Let the hooks catch up too: npx gohive login');
    if (!yes && process.stdin.isTTY && process.stdout.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        for (const agent of agents) {
          const answer = await prompt.question(`Open ${agent === 'claude' ? 'Claude Code' : 'Codex'} sign-in now? [y/N] `);
          if (!/^y(es)?$/i.test(answer.trim())) continue;
          const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex') };
          delete env.CLAUDE_CONFIG_DIR;
          const loginArgs = agent === 'codex' ? ['mcp', 'login', 'hive'] : [];
          spawnSync(agent, loginArgs, { env, stdio: 'inherit', cwd: home });
        }
        if (agents.includes('claude')) {
          const answer = await prompt.question('Open the lightweight hook sign-in too? [y/N] ');
          if (/^y(es)?$/i.test(answer.trim())) login(home, agents);
        }
      } finally { prompt.close(); }
    }
    doctor(options);
  } else if (command === 'doctor') {
    if (!doctor(options)) process.exitCode = 1;
  } else if (command === 'uninstall') uninstall(options);
  else if (command === 'login') login(home, agents);
  else if (command === 'help' || command === '--help' || command === '-h') console.log('Bring your agent to the hive\n\ngohive install [--yes] [--agent claude|codex]\ngohive doctor\ngohive login\ngohive uninstall\n\nOptions: --home <directory>, --backup-dir <directory>');
  else throw new Error(`Unknown command: ${command}. Run gohive --help`);
}

function login(home: string, agents: Agent[]) {
  const directory = agents.includes('claude') ? '.claude' : '.codex';
  const result = spawnSync(process.execPath, [join(home, directory, 'skills/hive/scripts/login.mjs')], { stdio: 'inherit', env: { ...process.env, HOME: home, HIVE_HOME: home } });
  if (result.status !== 0) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
