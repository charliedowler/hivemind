import { getLearning } from "@/server/hive";
import { authenticated } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticated(async (ctx) => {
    const learning = await getLearning(ctx, (await params).id);
    return learning ? Response.json(learning) : Response.json({ error: "Learning not found." }, { status: 404 });
  });
}
