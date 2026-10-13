import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beginSignIn, signInState, joinPhrase } from '../dist/onboarding.js';
const exec = promisify(execFile);
const bin = new URL('../dist/bin.js', import.meta.url).pathname;
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
test('join links accept only the Hive origin and a three-word phrase', () => {
  assert.equal(joinPhrase('https://gohive.dev/j/amber-honey-fox'), 'amber-honey-fox');
  assert.throws(() => joinPhrase('https://other.test/j/amber-honey-fox'));
  assert.throws(() => joinPhrase('https://gohive.dev/j/../../secret'));
});
for (const scenario of ['human', 'token-error', 'declined']) test(`${scenario} install returns while OAuth waits; status resumes and joins with its own human credential`, async t => {
  const identity = 'human';
  const home = mkdtempSync(join(tmpdir(), 'gohive-background-'));
  const fixtureBin=join(home,'fixture-bin');
  mkdirSync(fixtureBin);
  writeFileSync(join(fixtureBin,'claude'),`#!${process.execPath}\nimport fs from 'node:fs';\nimport path from 'node:path';\nif (process.argv.includes('add')) fs.writeFileSync(path.join(process.env.HOME,'.claude.json'),JSON.stringify({mcpServers:{hive:{type:'http',url:'https://gohive.dev/api/mcp'}}}));\n`,{mode:0o755});
  const fixtureEnv={...process.env,PATH:fixtureBin+':'+process.env.PATH,CI:'true',CLAUDECODE:'1'};
  let baseUrl, redirect, verifier, lastPhrase, releaseExchange;
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const c of request) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const send = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    if (request.url === '/.well-known/oauth-protected-resource') return send({authorization_servers:[baseUrl],scopes_supported:['hive','hive:person']});
    if (request.url === '/.well-known/oauth-authorization-server') return send({registration_endpoint:baseUrl+'/register',authorization_endpoint:baseUrl+'/authorize',token_endpoint:baseUrl+'/token',scopes_supported:['hive','hive:person','offline_access']});
    if (request.url === '/register') { redirect = JSON.parse(body).redirect_uris[0]; return send({client_id:'hook-fixture'}); }
    if (request.url === '/token') { if (scenario === 'token-error') { response.writeHead(400).end('private-error-fixture'); return; } if (identity === 'human') await new Promise(resolve=>releaseExchange=resolve); verifier = new URLSearchParams(body).get('code_verifier'); return send({access_token:'hook-fixture-token',refresh_token:'refresh-fixture',expires_in:3600}); }
    if (request.url === '/api/mcp' && !request.headers.authorization) { response.writeHead(401, {'WWW-Authenticate':`Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`}).end(); return; }
    if (request.url === '/api/mcp') {
      assert.equal(request.headers.authorization,'Bearer hook-fixture-token');
      const rpc = JSON.parse(body);
      if (!rpc.id) { response.writeHead(202).end(); return; }
      if (rpc.method === 'initialize') return send({jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:'2025-03-26'}});
      calls.push(rpc.params.name);
      let result = {};
      if (rpc.params.name === 'hive_join') { lastPhrase=rpc.params.arguments.phrase; result={joined:true,teamName:'Lightdash'}; }
      if (rpc.params.name === 'hive_invite_link') result={invitations:[{teamName:'Lightdash',joinUrl:'https://gohive.dev/j/amber-honey-fox',invitePrompt:'Team prompt fixture',paused:false}]};
      return send({jsonrpc:'2.0',id:rpc.id,result:{content:[{type:'text',text:JSON.stringify(result)}]}});
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  baseUrl=`http://127.0.0.1:${server.address().port}`;
  const previous = {HIVE_URL:process.env.HIVE_URL,HIVE_NO_BROWSER:process.env.HIVE_NO_BROWSER};
  process.env.HIVE_URL=baseUrl; process.env.HIVE_NO_BROWSER='1';
  t.after(() => { const state=signInState(home); try { process.kill(state.pid); } catch {} server.close(); for(const [key,value] of Object.entries(previous)) value===undefined?delete process.env[key]:process.env[key]=value; });
  const logs=[];
  const start=Date.now();
  const installed=await exec(process.execPath,[bin,'login','--client','claude','--home',home,'--join-url','https://gohive.dev/j/amber-honey-fox',...(identity==='agent'?['--identity','agent']:[])],{env:{...fixtureEnv,HIVE_URL:baseUrl,HIVE_NO_BROWSER:'1'},timeout:20000});
  logs.push(...installed.stdout.trim().split('\n'));
  assert.equal(logs[0],`gohive ${version}`);
  assert.ok(Date.now()-start<20000);
  const state=signInState(home);
  assert.equal(state.phase,'waiting');
  assert.equal(statSync(join(home,'.hive/sign-in.json')).mode&0o777,0o600);
  const instruction = identity === 'human' ? 'Sign in with Google in the tab that just opened; run `npx gohive status` when done.' : 'Approve this sign-in as the agent at https://auth.agentid.com using its AgentMail command, then run `npx gohive status`.';
  assert.ok(logs.includes(instruction));
  assert.ok(!logs.some(line=>line.includes('as yourself')));
  assert.equal(new URL(state.url).pathname,identity==='agent'?'/api/auth/agentid/start':'/authorize');
  const env={...process.env,HOME:home,HIVE_HOME:home,CODEX_HOME:join(home,'.codex')};
  const pending=await exec(process.execPath,[bin,'status','--home',home],{env,timeout:20000});
  assert.ok(pending.stdout.includes('Open '));
  assert.ok(pending.stdout.includes(identity === 'human' ? 'Sign in with Google in the tab that just opened; run `npx gohive status` when done.' : 'Approve this sign-in as the agent'));
  if (scenario === 'human') {
    await new Promise(resolve=>setTimeout(resolve,60000));
    process.kill(state.pid,0);
    const later=await exec(process.execPath,[bin,'status','--home',home],{env,timeout:20000});
    assert.ok(later.stdout.includes('Open '));
    assert.equal(signInState(home).attempt,state.attempt);
    assert.equal(signInState(home).url,state.url);
  }
  const callback=new URL(redirect); callback.searchParams.set('state',new URL(state.url).searchParams.get('state')); callback.searchParams.set('code','fixture-code');
  const invalid = new URL(callback); invalid.searchParams.set('state', 'wrong-secret-state');
  const rejected = await fetch(invalid, { redirect: 'manual' });
  assert.equal(rejected.status, 302);
  assert.equal(rejected.headers.get('location'), 'https://gohive.dev/signed-in?error=1');
  if (scenario === 'declined') { callback.searchParams.delete('code'); callback.searchParams.set('error', 'private-error-fixture'); }
  const callbackPending=fetch(callback, { redirect: 'manual' });
  if (scenario === 'human') {
    for(let i=0;i<100&&!releaseExchange;i++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(releaseExchange);
    const finishing=await exec(process.execPath,[bin,'status','--home',home],{env,timeout:20000});
    assert.ok(finishing.stdout.includes('Finishing sign-in'));
    assert.equal(signInState(home).attempt,state.attempt);
    releaseExchange();
  }
  const callbackResult=await callbackPending;
  assert.equal(callbackResult.status,302);
  assert.equal(callbackResult.headers.get('referrer-policy'), 'no-referrer');
  if (['token-error', 'declined'].includes(scenario)) {
    assert.equal(callbackResult.headers.get('location'), 'https://gohive.dev/signed-in?error=1');
    for(let i=0;i<50 && signInState(home).phase!=='failed';i++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(signInState(home).phase, 'failed');
    return;
  }
  assert.equal(callbackResult.headers.get('location'), 'https://gohive.dev/signed-in?client=claude');
  assert.ok(JSON.parse(readFileSync(join(home,'.hive/oauth.json'),'utf8')).access_token);
  for(let i=0;i<50 && signInState(home).phase!=='connected';i++) await new Promise(resolve=>setTimeout(resolve,20));
  const complete=await exec(process.execPath,[bin,'status','--home',home],{env,timeout:20000});
  assert.ok(complete.stdout.includes("You're in Lightdash."));
  if (identity === 'human') assert.ok(complete.stdout.includes('run /mcp to reconnect Hive'));
  assert.ok(!complete.stdout.includes('Team prompt fixture'));
  assert.ok(!complete.stdout.includes('Team prompt fixture'));
  assert.equal(lastPhrase,'amber-honey-fox');
  assert.ok(verifier.length>=32);
  assert.equal(createHash('sha256').update(verifier).digest('base64url'),new URL(state.url).searchParams.get('code_challenge'));
  const stored=JSON.parse(readFileSync(join(home,'.hive/oauth.json'),'utf8'));
  assert.equal(stored.client_id,'hook-fixture');
  await exec(process.execPath,[bin,'status','--home',home],{env,timeout:20000});
  assert.equal(signInState(home).attempt,state.attempt);
  assert.equal(calls.filter(name=>name==='hive_join').length,1);
});
