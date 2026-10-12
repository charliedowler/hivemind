import { authenticated } from "@/lib/http";
import { browseKnowledge, readKnowledge, snapshotKnowledge } from "@/server/knowledge-tree";
export const maxDuration = 60;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return authenticated(async (ctx) => Response.json(params.get("read") === "true" ? await readKnowledge(ctx, params.get("path") ?? "INDEX.md") : await browseKnowledge(ctx, params.get("path") ?? "")));
}
export async function POST() {
  return authenticated(async (ctx) => Response.json(await snapshotKnowledge(ctx)));
}
