import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beginSignIn, signInState, joinPhrase } from '../dist/onboarding.js';
const exec = promisify(execFile);
const bin = new URL('../dist/bin.js', import.meta.url).pathname;
test('join links accept only the Hive origin and a three-word phrase', () => {
  assert.equal(joinPhrase('https://gohive.dev/j/amber-honey-fox'), 'amber-honey-fox');
  assert.throws(() => joinPhrase('https://other.test/j/amber-honey-fox'));
  assert.throws(() => joinPhrase('https://gohive.dev/j/../../secret'));
});
for (const identity of ['human', 'agent']) test(`${identity} install returns while OAuth waits; status resumes and joins with its own human credential`, async t => {
  const home = mkdtempSync(join(tmpdir(), 'gohive-background-'));
  let baseUrl, redirect, verifier, lastPhrase;
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const c of request) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const send = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    if (request.url === '/.well-known/oauth-protected-resource') return send({authorization_servers:[baseUrl],scopes_supported:['hive','hive:person']});
    if (request.url === '/.well-known/oauth-authorization-server') return send({registration_endpoint:baseUrl+'/register',authorization_endpoint:baseUrl+'/authorize',token_endpoint:baseUrl+'/token',scopes_supported:['hive','hive:person','offline_access']});
    if (request.url === '/register') { redirect = JSON.parse(body).redirect_uris[0]; return send({client_id:'hook-fixture'}); }
    if (request.url === '/token') { verifier = new URLSearchParams(body).get('code_verifier'); return send({access_token:'hook-fixture-token',refresh_token:'refresh-fixture',expires_in:3600}); }
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
  if (identity === 'human') await beginSignIn({home,agents:[],identity:'agent',log:()=>{}});
  const start=Date.now();
  await beginSignIn({home,agents:[],identity,phrase:'amber-honey-fox',log:line=>logs.push(line)});
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
  const callback=new URL(redirect); callback.searchParams.set('state',new URL(state.url).searchParams.get('state')); callback.searchParams.set('code','fixture-code');
  assert.equal((await fetch(callback)).status,200);
  for(let i=0;i<50 && signInState(home).phase!=='connected';i++) await new Promise(resolve=>setTimeout(resolve,20));
  const complete=await exec(process.execPath,[bin,'status','--home',home],{env,timeout:20000});
  assert.ok(complete.stdout.includes("You're in Lightdash."));
  if (identity === 'human') assert.ok(complete.stdout.includes('run /mcp to reconnect Hive'));
  assert.ok(complete.stdout.includes('Team prompt fixture'));
  assert.ok(complete.stdout.includes('https://gohive.dev/j/amber-honey-fox'));
  assert.equal(lastPhrase,'amber-honey-fox');
  assert.ok(verifier.length>=32);
  const stored=JSON.parse(readFileSync(join(home,'.hive/oauth.json'),'utf8'));
  assert.equal(stored.client_id,'hook-fixture');
  await exec(process.execPath,[bin,'status','--home',home],{env,timeout:20000});
  assert.equal(calls.filter(name=>name==='hive_join').length,1);
});
