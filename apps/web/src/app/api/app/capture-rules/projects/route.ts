import { hiveShareProjectsInput } from "@hivemind/core";
import { requireSameOrigin } from "@/lib/web-mutation";
import { humanActor } from "@/server/identity/onboarding-web";
import { authenticated, readJson } from "@/lib/http";
import { ownerCapturePolicy, shareProjects } from "@/server/project-sharing";

export async function GET() {
  return authenticated(async ctx => Response.json(await ownerCapturePolicy(ctx), {headers: {"Cache-Control": "private, no-store"}}));
}
export async function POST(request: Request) {
  return authenticated(async ctx => {
    requireSameOrigin(request);
    await humanActor(ctx);
    return Response.json(await shareProjects(ctx, hiveShareProjectsInput.parse(await readJson(request))), {headers: {"Cache-Control": "private, no-store"}});
  });
}
