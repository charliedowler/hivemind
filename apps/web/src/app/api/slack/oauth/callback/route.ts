import { authenticated } from "@/lib/http";
import { finishInstall } from "@/server/slack/install";
export async function GET(request: Request) {
  return authenticated(async (ctx) => {
    const url = new URL(request.url);
    if (url.searchParams.has("error"))
      return Response.redirect(
        `${process.env.PUBLIC_URL ?? url.origin}/app/settings/slack?error=denied`,
      );
    await finishInstall(
      ctx,
      url.searchParams.get("state") ?? "",
      url.searchParams.get("code") ?? "",
    );
    return Response.redirect(
      `${process.env.PUBLIC_URL ?? url.origin}/app/settings/slack?connected=1`,
    );
  });
}
