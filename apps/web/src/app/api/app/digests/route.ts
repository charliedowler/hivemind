import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireAdmin, account } from "@/server/identity/access";
import { HiveError } from "@/server/errors";
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
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new HiveError(
        "Open this page in Hive before changing a schedule.",
        403,
      );
    const data = z
      .object({
        action: z.enum(["save", "preview", "post"]),
        id: z.string().optional(),
        schedule: z.unknown().optional(),
      })
      .parse(await readJson(request));
    if (data.action === "preview") {
      const schedule = data.id
        ? await getSchedule(ctx.teamId, data.id)
        : digestScheduleInput.parse(data.schedule);
      const since =
        "lastCursor" in schedule
          ? new Date(String(schedule.lastCursor))
          : new Date(Date.now() - 7 * 86400000);
      return Response.json(
        await digestPreview(
          ctx.teamId,
          since,
          schedule,
          schedule.timezone,
          await digestTransport.authors(ctx.teamId),
          data.id,
          "coverageStart" in schedule ? new Date(String(schedule.coverageStart)) : since,
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
