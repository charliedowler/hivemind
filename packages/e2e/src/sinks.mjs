import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startSinks() {
  const events = [];
  const blobs = new Map();
  const server = createServer(async (request, response) => {
    try {
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : {};
      const path = new URL(request.url, 'http://localhost').pathname;
      let data;
      if (path === '/mail') {
        const event = { kind: 'mail', body, id: randomUUID() };
        events.push(event);
        data = { id: event.id };
      } else if (path.startsWith('/slack/')) {
        const method = path.slice('/slack/'.length);
        events.push({ kind: 'slack', method, body });
        data = { ok: true, ts: `${Math.floor(Date.now() / 1000)}.${String(events.length).padStart(6, '0')}`, channel: body.channel || 'D_E2E', user_id: 'U_E2E_BOT', team_id: 'T_E2E', members: [], response_metadata: { next_cursor: '' } };
        if (method === 'chat.postMessage' && String(body.channel).startsWith('U_E2E_')) data.channel = `D_E2E_${body.channel.slice(6)}`;
        if (method === 'conversations.open') data.channel = { id: `D_${String(body.users || 'E2E').replace(/^U_/, '')}` };
        if (method === 'users.info') data.user = { id: body.user, real_name: 'Robin Example', profile: { email: String(body.user).startsWith('U_E2E_') ? Buffer.from(body.user.slice(6), 'base64url').toString('utf8') : 'robin@example.com' } };
      } else if (path === '/events') { events.push(body); data = { ok: true }; }
      else if (path === '/blob/write') { blobs.set(body.key, body.content); data = { ok: true }; }
      else if (path === '/blob/read') { data = { content: blobs.get(body.key) }; }
      else { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(data));
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { events, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
