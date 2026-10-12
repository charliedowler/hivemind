import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { sameOrigin } from "@/server/slack/security";
import {
  changeChannel,
  slackSettings,
  disconnectSlack,
} from "@/server/slack/store";
import { syncChannels } from "@/server/slack/install";
import { enqueueSlack } from "@/server/slack/queue";
const input = z.object({
  action: z.enum(["refresh", "enable", "stop", "purge", "disconnect"]),
  channel: z.string().optional(),
});
export async function GET() {
  return authenticated(async (ctx) => Response.json(await slackSettings(ctx)));
}
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    sameOrigin(request);
    const data = input.parse(await readJson(request));
    if (data.action === "refresh") await syncChannels(ctx);
    else if (data.action === "disconnect") await disconnectSlack(ctx);
    else {
      const channel = z.string().min(1).parse(data.channel);
      const generation = await changeChannel(ctx, channel, data.action);
      if (data.action === "enable")
        await enqueueSlack(
          ctx.teamId,
          "backfill",
          `backfill:${channel}:${generation}`,
          {},
          channel,
          generation,
        );
    }
    return Response.json(await slackSettings(ctx));
  });
}
