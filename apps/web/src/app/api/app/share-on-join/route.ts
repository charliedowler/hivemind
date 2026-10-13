import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { humanActor } from "@/server/identity/onboarding-web";
import { shareWith } from "@/server/share-on-join";
export async function POST(request: Request) {
  return authenticated(async ctx => { requireSameOrigin(request); await humanActor(ctx); return Response.json(await shareWith(ctx, await readJson(request))); });
}
