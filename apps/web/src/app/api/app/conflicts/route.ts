import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import {
  listDecisions,
  reverseDecision,
  decisionRepos,
  updateDecisionReason,
} from "@/server/conflict-decisions";
import { decisionKinds } from "@/server/conflict-judgments";
import { redactSecrets } from "@hivemind/core";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return authenticated(async (ctx) => {
    const filters = z
      .object({
        decision: z
          .enum([...decisionKinds, "undecided", "reversed"])
          .optional(),
        repo: z.string().max(200).optional(),
        search: z.string().max(200).optional(),
      })
      .parse(Object.fromEntries(query));
    const [decisions, repos] = await Promise.all([
      listDecisions(ctx, filters),
      decisionRepos(ctx),
    ]);
    return Response.json({ decisions, repos });
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
    const reason = data.reason?.trim() ? redactSecrets(data.reason).text : undefined;
    const result = data.action === "reason"
      ? await updateDecisionReason(ctx, data.id, reason ?? `Reversed by ${ctx.memberName} on the dashboard`)
      : await reverseDecision(ctx, data.id, reason);
    const record = (await listDecisions(ctx, { id: result.id }))[0];
    return Response.json({ ...result, record });
  });
}
