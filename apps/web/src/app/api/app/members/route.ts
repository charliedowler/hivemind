import { listMembers, teamOverview } from "@/server/hive";
import { authenticated } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  return authenticated(async (ctx) => {
    const [members, overview] = await Promise.all([
      listMembers(ctx),
      teamOverview(ctx),
    ]);
    return Response.json({ members, overview });
  });
}
