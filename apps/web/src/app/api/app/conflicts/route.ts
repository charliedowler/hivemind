import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import {
  listDecisions,
  reverseDecision,
  updateDecisionReason,
} from "@/server/conflict-decisions";
import { redactSecrets } from "@hivemind/core";
export async function GET(request: Request) {
  return authenticated(async (ctx) => {
    const cellId = z
      .string()
      .min(1)
      .max(100)
      .parse(new URL(request.url).searchParams.get("cellId"));
    return Response.json({ decisions: await listDecisions(ctx, { cellId }) });
  });
}
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const data = z
      .object({
        id: z.string(),
        action: z.enum(["reverse", "reason"]),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(await readJson(request));
    const reason = data.reason?.trim()
      ? redactSecrets(data.reason).text
      : undefined;
    const result =
      data.action === "reason"
        ? await updateDecisionReason(
            ctx,
            data.id,
            reason ?? "Admin requested reversal",
          )
        : await reverseDecision(
            ctx,
            data.id,
            reason ?? "Admin requested reversal",
          );
    const record = (await listDecisions(ctx, { id: result.id }))[0];
    return Response.json({ ...result, record });
  });
}
