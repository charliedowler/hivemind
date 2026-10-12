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
    const payload = JSON.parse(
      new URLSearchParams(body).get("payload") ?? "{}",
    );
    if (
      payload.type !== "message_action" ||
      payload.callback_id !== "hive_save_message"
    )
      return Response.json({ ok: true });
    const rows =
      await getSql()`SELECT team_id FROM slack_installations WHERE workspace_id=${String(payload.team?.id)} AND active=true`;
    if (rows[0])
      await enqueueSlack(
        String(rows[0].team_id),
        "action",
        `action:${hashToken(body)}`,
        payload,
        String(payload.channel?.id),
      );
    return new Response(null, { status: 200 });
  } catch (error) {
    return httpError(error);
  }
}
