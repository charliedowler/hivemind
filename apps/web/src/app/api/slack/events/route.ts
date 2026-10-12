import { httpError } from "@/lib/http";
import { eventEnvelope, acceptSlackEvent } from "@/server/slack/events";
import { verifySlack } from "@/server/slack/security";
export const maxDuration = 30;
export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 1_000_000 || !verifySlack(body, request.headers))
    return Response.json(
      { error: "Slack signature is invalid." },
      { status: 401 },
    );
  try {
    const payload = eventEnvelope.parse(JSON.parse(body));
    if (payload.type === "url_verification")
      return Response.json({ challenge: payload.challenge });
    await acceptSlackEvent(payload);
    return Response.json({ ok: true });
  } catch (error) {
    return httpError(error);
  }
}
