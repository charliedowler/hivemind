import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireAdmin, account } from "@/server/identity/access";
import { validateChannel } from "@/server/slack/install";
import { sameOrigin } from "@/server/slack/security";
import {
  digestChannels,
  digestChannel,
  digestTransport,
} from "@/server/digests/connection";
import {
  digestHistory,
  getSchedule,
  listSchedules,
  saveSchedule,
} from "@/server/digests/store";
import { digestPreview } from "@/server/digests/data";
import { postNow } from "@/server/digests/runner";
import { digestScheduleInput } from "@hivemind/core";
export async function GET() {
  return authenticated(async (ctx) => {
    const [schedules, history, channels, member] = await Promise.all([
      listSchedules(ctx.teamId),
      digestHistory(ctx.teamId),
      digestChannels(ctx),
      account(ctx),
    ]);
    return Response.json({
      schedules,
      history,
      channels,
      isAdmin: member.member.role === "admin",
    });
  });
}
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    sameOrigin(request);
    const data = z
      .object({
        action: z.enum(["save", "preview", "post"]),
        id: z.string().optional(),
        schedule: z.unknown().optional(),
      })
      .parse(await readJson(request));
    if (data.action === "preview") {
      const stored = data.id ? await getSchedule(ctx.teamId, data.id) : null;
      const schedule = data.schedule
        ? digestScheduleInput.parse(data.schedule)
        : stored;
      if (!schedule) throw new Error("Provide a schedule to preview.");
      const since = stored
        ? new Date(stored.lastCursor)
        : new Date(Date.now() - 7 * 86400000);
      const { channel } = await validateChannel(ctx.teamId, schedule.channelId);
      return Response.json(
        await digestPreview(
          ctx.teamId,
          since,
          schedule,
          schedule.timezone,
          await digestTransport.authors(ctx.teamId),
          data.id,
          stored ? new Date(stored.coverageStart) : since,
          !channel.is_private,
        ),
      );
    }
    await requireAdmin(ctx);
    if (data.action === "post")
      return Response.json(
        await postNow(ctx, z.string().parse(data.id), digestTransport),
      );
    const schedule = digestScheduleInput.parse(data.schedule);
    return Response.json(
      await saveSchedule(
        ctx,
        schedule,
        await digestChannel(ctx, schedule.channelId),
        data.id,
      ),
    );
  });
}
