import { authenticated } from "@/lib/http";
import { beginInstall } from "@/server/slack/install";
export async function GET() {
  return authenticated(async (ctx) =>
    Response.redirect(await beginInstall(ctx)),
  );
}
