export function authErrorRedirect(request: Request, reason: string) {
  const url = new URL("/app/auth-error", request.url);
  url.searchParams.set("error", reason);
  return Response.redirect(url, 303);
}

export async function browserAuthResponse(request: Request, response: Response) {
  if (response.status === 404) return Response.json({ error: "not_found" }, { status: 404 });
  if (request.method !== "GET" || !request.headers.get("accept")?.includes("text/html") || response.ok || response.status < 400) return response;
  const body = await response.clone().json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : "unknown";
  return authErrorRedirect(request, code);
}
