import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.HIVE_E2E_LOG, JSON.stringify({ command: 'executor', args }) + '\n');
if (args[0] === '--version') {
  console.log('executor v1.6.8');
} else {
  const path = args.slice(0, -1).join('.');
  let data;
  if (path === 'call.executor.coreTools.connections.list') data = { connections: [{ integration: 'gohive_mcp', lastHealth: { status: 'healthy' } }] };
  else if (path === 'call.executor.coreTools.integrations.list') data = { integrations: [{ slug: 'gohive_mcp', kind: 'mcp' }] };
  else if (path === 'call.executor.mcp.getServer' && JSON.parse(args.at(-1)).slug === 'gohive_mcp') data = { integration: { slug: 'gohive_mcp', config: { endpoint: `${process.env.HIVE_URL}/api/mcp` } } };
  else throw new Error(`Guard called an unexpected Executor operation: ${path}`);
  console.log(JSON.stringify({ ok: true, data }));
}
