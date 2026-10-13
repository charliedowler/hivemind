import { getWebContext } from "../auth";
import { getLearning } from "../hive";
import { withHiveBearerAuth } from "../bearer-auth";
import { z } from "zod";
import { httpError } from "@/lib/http";
import { originFor, recordEvent, withOrigin } from "./events";
import { rateLimit } from "../identity/rate-limit";

function parseBeacon(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Send a valid event."), { status: 400 });
  }
}
export async function beaconInput(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw Object.assign(new Error("Use the Hive page to send this event."), {
      status: 403,
    });
  const text = await request.text();
  if (text.length > 1024)
    throw Object.assign(new Error("Event is too large."), { status: 413 });
  return parseBeacon(text);
}
export async function learningBeacon(request: Request) {
  try {
    const ctx = await getWebContext();
    if (!ctx) return new Response(null, { status: 401 });
    const { learningId } = z
      .object({ learningId: z.string().regex(/^lrn_[a-z2-7]{12}$/) })
      .parse(await beaconInput(request));
    if (!(await getLearning(ctx, learningId)))
      return new Response(null, { status: 404 });
    await recordEvent({
      name: "learning.viewed",
      learningId,
      origin: originFor(ctx),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return httpError(error);
  }
}
const clientReport = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("install"),
    step: z.enum([
      "started",
      "mcp_configured",
      "instructions_written",
      "hook_configured",
      "completed",
      "doctor",
    ]),
    outcome: z.enum(["completed", "failed", "skipped"]),
    agent: z.enum(["claude-code", "codex", "executor"]),
    platform: z.enum(["darwin", "linux", "win32", "unknown"]),
    attemptId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("hook"),
    hookKind: z.enum(["session_start", "stop"]),
    gateDecision: z.enum(["capture", "skip"]),
    pushedCount: z.number().int().min(0).max(100).nullable(),
    attemptId: z.string().uuid(),
  }),
]);
export async function clientBeacon(request: Request, kind: "install" | "hook") {
  try {
    return await withHiveBearerAuth(request, async (request, ctx, claims) => {
    const text = await request.text();
    if (text.length > 1024) return new Response(null, { status: 413 });
    const input = clientReport.parse({
      ...(parseBeacon(text) as object),
      kind,
    });
    await rateLimit(
      "analytics-client",
      `${ctx.teamId}/${ctx.memberId}`,
      120,
      60,
    );
    await withOrigin(
      originFor(ctx, kind === "install" ? "installer" : "hook", claims ? "oauth" : "api_key"),
      async () => {
        if (input.kind === "install")
          await recordEvent({
            name: "install.step",
            key: `${ctx.teamId}:${ctx.memberId}:${input.attemptId}:${input.step}`,
            outcome: input.outcome,
            reasonCode:
              input.outcome === "failed"
                ? input.step === "doctor"
                  ? "doctor_failed"
                  : "installer_failed"
                : null,
            properties: {
              step: input.step,
              agent: input.agent,
              platform: input.platform,
            },
          });
        else
          await recordEvent({
            name: "hook.fired",
            key: `${ctx.teamId}:${ctx.memberId}:${input.attemptId}`,
            outcome: input.gateDecision,
            properties: {
              hookKind: input.hookKind,
              gateDecision: input.gateDecision,
              pushedCount: input.pushedCount,
            },
          });
      },
    );
    return new Response(null, { status: 204 });
    });
  } catch (error) {
    return httpError(error);
  }
}
