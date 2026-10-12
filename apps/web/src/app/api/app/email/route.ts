import { z } from "zod";
import { getWebContext } from "@/server/auth";
import {
  sendEmailCode,
  completeEmailCode,
} from "@/server/identity/email-verification";
import { httpError, identity, readJson } from "@/lib/http";
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
