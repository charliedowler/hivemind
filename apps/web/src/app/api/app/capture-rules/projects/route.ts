import { hiveShareProjectsInput } from "@hivemind/core";
import { authenticated, readJson } from "@/lib/http";
import { ownerCapturePolicy, shareProjects } from "@/server/project-sharing";

export async function GET() {
  return authenticated(async ctx => Response.json(await ownerCapturePolicy(ctx), {headers: {"Cache-Control": "private, no-store"}}));
}
export async function POST(request: Request) {
  return authenticated(async ctx => Response.json(await shareProjects(ctx, hiveShareProjectsInput.parse(await readJson(request))), {headers: {"Cache-Control": "private, no-store"}}));
}
