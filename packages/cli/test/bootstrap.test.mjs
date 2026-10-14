import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureAgentBearer } from '../dist/agent-config.js';
import { markInstructions } from '../dist/installer.js';
import { prepareHumanLogin, revokeInstalledAgent } from '../dist/bootstrap.js';
const exec=promisify(execFile);
const bin=new URL('../dist/bin.js',import.meta.url).pathname;
const fixtureBin=mkdtempSync(join(tmpdir(),'hive-bootstrap-bin-'));
writeFileSync(join(fixtureBin,'executor'),'#!/bin/sh\nexit 1\n',{mode:0o755});
const testEnv={...process.env,PATH:fixtureBin+':'+process.env.PATH,HIVE_EXECUTOR_TOOLS:'0'};
const credential='ha_'+'x'.repeat(43);
test('the email question changes no config and reports the native picker choices',async()=>{
  const home=mkdtempSync(join(tmpdir(),'hive-email-'));
  await exec('git',['init',home]);await exec('git',['-C',home,'config','user.email','person@example.test']);
  const result=await exec(process.execPath,[bin,'install','--skip-executor','--home',home],{cwd:home,env:{...testEnv,CLAUDECODE:'1'}});
  const question=JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(question.status,'needs_email');assert.equal(question.question,'I found person@example.test. Use it, or type a different one?');assert.deepEqual(question.picker.options,['Yes','Type a different one']);
  assert.equal(existsSync(join(home,'.claude.json')),false);assert.equal(existsSync(join(home,'.hive/install.json')),false);
});
for(const client of ['claude','codex'])test(`${client} gets a bearer with --email, status is quiet, and uninstall revokes it`,async t=>{
  const home=mkdtempSync(join(tmpdir(),'hive-bootstrap-cli-'));let bootstraps=0,revoked=false;
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();
    const send=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    if(req.url==='/api/agents/bootstrap'){const data=JSON.parse(body);assert.equal(data.email,'person@example.test');assert.equal(data.joinPhrase,'amber-honey-fox');bootstraps++;return send({status:'issued',credential,agentId:'agent_fixture',claimPending:true});}
    if(req.url==='/api/cli/version') { assert.equal(req.headers.authorization, undefined); return send({ latest:'0.2.1', minimum:'0.2.0' }); }
    assert.equal(req.headers.authorization,`Bearer ${credential}`);
    if(req.url==='/api/agents/status')return send({claimPending:true,organisations:[],joinPending:'amber-honey-fox',shareOffers:[]});
    if(req.url==='/api/agents/revoke'){revoked=true;return send({revoked:true});}res.writeHead(404).end();
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const env={...testEnv,HIVE_URL:`http://127.0.0.1:${server.address().port}`,CLAUDECODE:client==='claude'?'1':'',CODEX_THREAD_ID:client==='codex'?'fixture':''};
  const installed=await exec(process.execPath,[bin,'install','--skip-executor','--home',home,'--email','person@example.test','--join-url','https://gohive.dev/j/amber-honey-fox'],{env});
  assert.ok(installed.stdout.includes(`Installing Hive for ${client==='claude'?'Claude Code':'Codex'}`));assert.ok(!installed.stdout.includes('Open http'));assert.ok(!installed.stdout.includes(credential));
  assert.equal(bootstraps,1);assert.equal(statSync(join(home,'.hive/agent.json')).mode&0o777,0o600);
  if(client==='claude')assert.equal(JSON.parse(readFileSync(join(home,'.claude.json'),'utf8')).mcpServers.hive.headers.Authorization,`Bearer ${credential}`);
  else{const config=readFileSync(join(home,'.codex/config.toml'),'utf8');assert.ok(config.includes('http_headers_helper = '));assert.ok(config.includes('enabled = true'));assert.ok(!config.includes('[plugins.'));assert.ok(!config.includes('[apps.'));assert.ok(!config.includes('bearer_token_env_var'));assert.ok(config.includes(`Bearer ${credential}`));const helper=await exec(process.execPath,[join(home,'.codex/skills/hive/scripts/agent-headers.mjs'),home],{env:{...env,HIVE_AGENT_TOKEN:credential}});assert.equal(JSON.parse(helper.stdout).Authorization,`Bearer ${credential}`);}
  const status=await exec(process.execPath,[bin,'status','--home',home],{env});assert.ok(status.stdout.includes('Installed. Signed in. Hive is ready.'));assert.ok(!status.stdout.includes('Installing Hive'));assert.ok(!status.stdout.includes('Set me up on Hive'));
  await exec(process.execPath,[bin,'uninstall','--home',home],{env});assert.equal(revoked,true);assert.equal(existsSync(join(home,'.hive/agent.json')),false);
});
test('claimed-human installation waits for the one-click link, then status writes its credential',async t=>{
 const home=mkdtempSync(join(tmpdir(),'hive-claimed-cli-'));let approved=false;
 const server=createServer(async(req,res)=>{for await(const c of req){};const send=v=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(v));if(req.url==='/api/agents/bootstrap')return send({status:'link_sent',requestId:'pending',pollingToken:'y'.repeat(43)});if(req.url==='/api/agents/connect')return send(approved?{status:'issued',credential,agentId:'agent_fixture',claimPending:false}:{status:'pending'});if(req.url==='/api/agents/status')return send({claimPending:false,organisations:[{teamName:'Example team'}],shareOffers:[]});if(req.url==='/api/mcp'){const rpc=JSON.parse(Buffer.concat([]).toString()||'{}');res.writeHead(204).end();return;}res.writeHead(404).end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const env={...testEnv,CLAUDECODE:'1',HIVE_URL:`http://127.0.0.1:${server.address().port}`};
 const result=await exec(process.execPath,[bin,'install','--skip-executor','--email','person@example.test','--home',home],{env});assert.ok(result.stdout.includes('Click the link in your email to connect this machine'));assert.equal(existsSync(join(home,'.claude.json')),false);
 approved=true;const status=await exec(process.execPath,[bin,'status','--home',home],{env});assert.ok(status.stdout.includes('Account claimed'));assert.equal(JSON.parse(readFileSync(join(home,'.claude.json'),'utf8')).mcpServers.hive.headers.Authorization,`Bearer ${credential}`);
});
test('both configs preserve unrelated servers and credentials never appear in announcements',()=>{
 const home=mkdtempSync(join(tmpdir(),'hive-bearer-config-'));mkdirSync(join(home,'.codex'));writeFileSync(join(home,'.codex/config.toml'),'[mcp_servers.other]\ncommand="other"\n');writeFileSync(join(home,'.claude.json'),JSON.stringify({mcpServers:{other:{command:'keep'}}}));const logs=[];
 configureAgentBearer(home,['claude','codex'],credential,undefined,line=>logs.push(line));assert.deepEqual(JSON.parse(readFileSync(join(home,'.claude.json'),'utf8')).mcpServers.other,{command:'keep'});assert.ok(readFileSync(join(home,'.codex/config.toml'),'utf8').includes('[mcp_servers.other]'));assert.ok(!logs.join('\n').includes(credential));
});
test('a human login removes the agent bearer and a pending uninstall cancels its request',async t=>{
 const home=mkdtempSync(join(tmpdir(),'hive-switch-human-'));mkdirSync(join(home,'.hive'));
 let revoked=false,cancelled=false;const server=createServer(async(req,res)=>{for await(const chunk of req){}if(req.url==='/api/agents/revoke')revoked=true;if(req.url==='/api/agents/connect'&&req.method==='DELETE')cancelled=true;res.writeHead(200,{'Content-Type':'application/json'}).end('{}')});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const baseUrl=`http://127.0.0.1:${server.address().port}`;writeFileSync(join(home,'.hive/agent.json'),JSON.stringify({baseUrl,agents:['claude','codex'],credential}));configureAgentBearer(home,['claude','codex'],credential,baseUrl+'/api/mcp');
 await prepareHumanLogin(home,['claude','codex']);assert.equal(revoked,true);assert.equal(existsSync(join(home,'.hive/agent.json')),false);assert.equal(JSON.parse(readFileSync(join(home,'.claude.json'),'utf8')).mcpServers.hive.headers,undefined);assert.ok(!readFileSync(join(home,'.codex/config.toml'),'utf8').includes(credential));
 writeFileSync(join(home,'.hive/agent.json'),JSON.stringify({baseUrl,agents:['claude'],requestId:'pending',pollingToken:'y'.repeat(43)}));await revokeInstalledAgent(home);assert.equal(cancelled,true);assert.equal(existsSync(join(home,'.hive/agent.json')),false);
});
test('missing tools never trigger installation during routine work and all onboarding questions use pickers',()=>{
 const skill=readFileSync(new URL('../../../skills/hive/SKILL.md',import.meta.url),'utf8');
 for(const text of ["Ask with the harness's question/picker tool when one exists; otherwise a numbered list.",'AskUserQuestion','multiSelect','request_user_input','github.com/<org>/*','npx --yes gohive@latest status','NEVER run the installer unless','Hive is set up but not loaded in this session; restart Codex (or run /mcp in Claude Code) to use it','retry once with the version status printed','Never announce installation outside an actual install'])assert.ok(skill.includes(text),text);
 for(const client of ['claude','codex','executor']){const instructions=markInstructions('',client);assert.ok(instructions.includes('NEVER run the installer unless'));assert.ok(instructions.includes("Ask with the harness's question/picker tool when one exists; otherwise a numbered list."));assert.ok(instructions.includes('npx --yes gohive@latest status'));}
 assert.ok(!skill.includes('npx --no-install'));
});

test('a stale native Codex sign-in phase from an old install does not send a Claude Code person to Codex',async t=>{
  const home=mkdtempSync(join(tmpdir(),'hive-stale-native-'));
  const server=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/cli/version'){res.end(JSON.stringify({latest:'0.0.0',minimum:'0.0.0'}));return;}res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'{}'}]}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  mkdirSync(join(home,'.hive'),{recursive:true});
  writeFileSync(join(home,'.hive/install.json'),JSON.stringify({version:1,agents:['claude','codex'],files:{},registered:[],backupDirectories:[],ownedHooks:[]}));
  writeFileSync(join(home,'.hive/oauth.json'),JSON.stringify({baseUrl,access_token:'fixture-access',expires_at:Date.now()+3600000}));
  writeFileSync(join(home,'.hive/sign-in.json'),JSON.stringify({identity:'human',phase:'native-incomplete',started:Date.now()-86400000,agents:['claude','codex']}));
  writeFileSync(join(home,'.hive/update.json'),JSON.stringify({checkedAt:Date.now()}));
  const env={...testEnv,HIVE_URL:baseUrl,CLAUDECODE:'1',CODEX_THREAD_ID:''};
  const status=await exec(process.execPath,[bin,'status','--home',home],{env});
  assert.ok(status.stdout.includes('Installed. Signed in. Hive is ready.'),status.stdout);
  assert.ok(!status.stdout.includes('codex mcp login'),status.stdout);
  assert.ok(status.stdout.includes('run /mcp to reconnect Hive'),status.stdout);
});
