import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { saveCredentials } from '../assets/hive/scripts/mcp.mjs';

const exec = promisify(execFile);
const helper = new URL('../assets/hive/scripts/headers.mjs', import.meta.url).pathname;
test('Claude headers use the selected hook store and refresh the same grant without OAuth prompts', async t => {
  const home=mkdtempSync(join(tmpdir(),'hive-headers-'));
  let refreshes=0;
  const server=createServer(async (request,response)=>{
    let body=''; for await(const chunk of request) body+=chunk;
    assert.equal(request.url,'/token');
    const params=new URLSearchParams(body);
    assert.equal(params.get('grant_type'),'refresh_token');
    assert.equal(params.get('refresh_token'),'refresh-fixture');
    assert.equal(params.get('client_id'),'registered-fixture');
    refreshes++;
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({access_token:'refreshed-fixture',refresh_token:'rotated-fixture',expires_in:3600}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const env={...process.env,HIVE_URL:baseUrl,HIVE_KEY:'',HIVE_HOME:'/wrong-home'};
  const run=()=>exec(process.execPath,[helper,home],{env,timeout:10000});
  assert.deepEqual(JSON.parse((await run()).stdout),{});
  saveCredentials({baseUrl,access_token:'expired-fixture',refresh_token:'refresh-fixture',client_id:'registered-fixture',token_endpoint:baseUrl+'/token',expires_at:1},home);
  assert.deepEqual(JSON.parse((await run()).stdout),{Authorization:'Bearer refreshed-fixture'});
  assert.deepEqual(JSON.parse((await run()).stdout),{Authorization:'Bearer refreshed-fixture'});
  assert.equal(refreshes,1);
  assert.equal(JSON.parse(readFileSync(join(home,'.hive/oauth.json'),'utf8')).refresh_token,'rotated-fixture');
});
