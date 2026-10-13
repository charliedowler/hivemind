import { getWebContext } from "@/server/auth";
import { finishInstall } from "@/server/slack/install";
import { authErrorRedirect } from "@/server/auth-error-response";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return authErrorRedirect(request, "access_denied");
  const ctx = await getWebContext();
  if (!ctx) return authErrorRedirect(request, "session_expired");
  try {
    await finishInstall(ctx, url.searchParams.get("state") ?? "", url.searchParams.get("code") ?? "");
  } catch (error) {
    return authErrorRedirect(request, error instanceof Error && "status" in error && error.status === 403 ? "access_changed" : "connection_expired");
  }
  return Response.redirect(new URL("/app/settings/slack?connected=1", request.url));
}
