import { webMemberPage } from "@/server/web-member-page";
import { authenticated } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  return authenticated(async (ctx) => Response.json(await webMemberPage(ctx)));
}
