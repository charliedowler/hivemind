import { getSql } from "@/server/db/client";
import { hashToken } from "@/server/db/ids";
import { verifySlack } from "@/server/slack/security";
import { enqueueSlack } from "@/server/slack/queue";
import { httpError } from "@/lib/http";
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifySlack(body, request.headers))
    return new Response("Invalid Slack signature.", { status: 401 });
  try {
    const payload = Object.fromEntries(new URLSearchParams(body));
    if (payload.command !== "/hive")
      return new Response("Unknown command.", { status: 400 });
    const rows =
      await getSql()`SELECT team_id FROM slack_installations WHERE workspace_id=${payload.team_id} AND active=true`;
    if (!rows[0])
      return Response.json({
        response_type: "ephemeral",
        text: "Connect Slack from hive settings first.",
      });
    await enqueueSlack(
      String(rows[0].team_id),
      "command",
      `command:${hashToken(body)}`,
      payload,
      payload.channel_id,
    );
    return Response.json({
      response_type: "ephemeral",
      text: "The hive is looking.",
    });
  } catch (error) {
    return httpError(error);
  }
}
