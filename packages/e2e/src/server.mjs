import { createServer } from 'node:http';
import { installNetworkGuard } from './network.mjs';
import { webRequire } from './paths.mjs';

installNetworkGuard(process.env.HIVE_E2E_SINK_URL);
const next = webRequire('next');
const app = next({ dev: true, webpack: true, dir: process.env.HIVE_E2E_APP_DIR, hostname: 'localhost', port: Number(process.env.PORT) });
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((request, response) => handler(request, response));
await new Promise(resolve => server.listen(Number(process.env.PORT), '127.0.0.1', resolve));
process.send?.({ ready: true });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { server.closeAllConnections(); server.close(); await app.close(); process.exit(0); });
