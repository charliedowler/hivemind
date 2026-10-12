import { z } from "zod";
import { getWebContext } from "@/server/auth";
import {
  sendEmailCode,
  completeEmailCode,
} from "@/server/identity/email-verification";
import { httpError, identity, readJson } from "@/lib/http";
import { getSql } from "@/server/db/client";
import { hashToken } from "@/server/db/ids";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const ctx = await getWebContext();
    if (!ctx || !body || typeof body !== "object" || !("intent" in body) || body.intent !== "account")
      return Response.json({ error: "Sign in to verify your account email." }, { status: 401 });
    return Response.json(
      await sendEmailCode(
        body,
        request.headers.get("x-vercel-forwarded-for") ?? "unknown",
        ctx ?? undefined,
      ),
      { status: 202 },
    );
  } catch (error) {
    return httpError(error);
  }
}
export async function PUT(request: Request) {
  try {
    const input = z
      .object({
        verificationToken: z.string().min(40).max(80),
        code: z.string().max(20),
      })
      .parse(await readJson(request));
    const ctx = await getWebContext();
    if (!ctx) return Response.json({ error: "Sign in first." }, { status: 401 });
    const pending = await getSql()`SELECT id FROM email_verifications WHERE token_hash = ${hashToken(input.verificationToken)} AND payload->>'intent' = 'account' AND payload->>'teamId' = ${ctx.teamId} AND payload->>'memberId' = ${ctx.memberId}`;
    if (!pending.length) return Response.json({ error: "Verify your account email with a new code." }, { status: 400 });
    const result = await completeEmailCode(
      input.verificationToken,
      input.code,
      request.headers.get("x-vercel-forwarded-for") ?? "unknown",
      ctx ?? undefined,
    );
    if (result.apiKey) return Response.json({ error: "Create or join with an email account at /app/login." }, { status: 410 });
    return Response.json(
      {
        ...identity(result.ctx),
        apiKey: result.apiKey,
        inviteCode: result.inviteCode,
      },
      { status: result.apiKey ? 201 : 200 },
    );
  } catch (error) {
    return httpError(error);
  }
}
