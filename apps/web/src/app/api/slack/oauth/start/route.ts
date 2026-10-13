import { authenticated } from "@/lib/http";
import { beginInstall } from "@/server/slack/install";
import { authErrorRedirect } from "@/server/auth-error-response";
export async function GET(request: Request) {
  const response = await authenticated(async (ctx) => Response.redirect(await beginInstall(ctx)));
  if (!request.headers.get("accept")?.includes("text/html") || response.status < 400) return response;
  return authErrorRedirect(request, response.status === 401 ? "session_expired" : response.status === 403 ? "access_changed" : "unknown");
}
