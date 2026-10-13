export function installNetworkGuard(sinkUrl) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(sinkUrl || '')) throw new Error('The E2E sink must be local.');
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return original(input, init);
    const request = new Request(input, init);
    const rawBody = await request.text();
    let body;
    try { body = JSON.parse(rawBody); } catch { body = Object.fromEntries(new URLSearchParams(rawBody || url.search)); }
    let destination;
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') destination = `${sinkUrl}/mail`;
    if (url.hostname === 'slack.com' && url.pathname.startsWith('/api/')) destination = `${sinkUrl}/slack/${url.pathname.slice(5)}`;
    if (destination) return original(destination, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await original(`${sinkUrl}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'network-blocked', host: url.hostname, path: url.pathname }) });
    throw new Error(`E2E blocked external request: ${url.origin}${url.pathname}`);
  };
}
