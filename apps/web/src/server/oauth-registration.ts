export async function normalizeOAuthRegistration(request: Request) {
  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/oauth2/register")) return request;
  let body: Record<string, unknown>;
  try { body = await request.clone().json(); } catch { return request; }
  if (!body || body.application_type !== undefined || !Array.isArray(body.redirect_uris)) return request;
  const native = body.redirect_uris.some((value) => {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return !["http:", "https:"].includes(url.protocol) || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    } catch { return false; }
  });
  if (!native) return request;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify({ ...body, application_type: "native" }) });
}
