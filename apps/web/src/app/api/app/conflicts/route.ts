import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import {
  listDecisions,
  reverseDecision,
  decisionRepos,
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
        action: z.literal("reverse"),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(await readJson(request));
    return Response.json(
      await reverseDecision(ctx, data.id, redactSecrets(data.reason).text),
    );
  });
}
