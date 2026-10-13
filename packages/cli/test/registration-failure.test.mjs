import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../dist/installer.js';
test('a Codex registration failure writes its config and completes Claude setup', () => {
  const home=mkdtempSync(join(tmpdir(),'hive-registration-'));
  const logs=[];
  const run=(command,args)=>{
    if(command==='codex')return {status:1,stdout:'',stderr:args.includes('get')?'No MCP server named hive found':'fixture native registration error'};
    if(args.includes('add'))writeFileSync(join(home,'.claude.json'),JSON.stringify({mcpServers:{hive:{type:'http',url:'https://gohive.dev/api/mcp'}}}));
    return {status:0,stdout:'',stderr:''};
  };
  const result=install({home,agents:['codex','claude'],run,log:line=>logs.push(line)});
  assert.ok(result.registered.includes('claude'));
  assert.ok(readFileSync(join(home,'.codex/config.toml'),'utf8').includes('https://gohive.dev/api/mcp'));
  assert.ok(JSON.parse(readFileSync(join(home,'.claude.json'),'utf8')).mcpServers.hive);
  assert.ok(logs.some(line=>line.includes('Codex')&&line.includes('config')));
});
