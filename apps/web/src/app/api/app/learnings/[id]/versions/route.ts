import { authenticated } from "@/lib/http";
import { learningVersions } from "@/server/lifecycle";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticated(async (ctx) => Response.json({ versions: await learningVersions(ctx, (await params).id) }));
}
