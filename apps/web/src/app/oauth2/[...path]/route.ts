import { authHandler } from "@/server/auth-handler";

export const runtime = "nodejs";
async function route(request: Request) {
  const url = new URL(request.url);
  url.pathname = `/api/auth${url.pathname}`;
  return authHandler(new Request(url, request));
}
export { route as GET, route as POST };
