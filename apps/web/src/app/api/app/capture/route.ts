import { withOrigin, originFor, recordEvent } from "@/server/analytics/events";
import { z } from "zod";
import { redactCaptureSecrets } from "@hivemind/core";
import { withHiveBearerAuth } from "@/server/bearer-auth";
import { HiveError } from "@/server/errors";
import { enforceCaptureRules } from "@/server/capture-rules";
import { requireSelectedProject } from "@/server/project-sharing";
import { classifyCapture } from "@/server/classify";
import { rateLimit } from "@/server/identity/rate-limit";
import { httpError, readJson } from "@/lib/http";

export const runtime = "nodejs";
const inputSchema = z.object({
  changes: z.number().int().min(0).max(10000),
  errors: z.number().int().min(0).max(10000),
  observations: z.number().int().min(0).max(10000),
  text: z.string().max(6000),
  repo: z.string().max(500).nullish(),
  remote: z.string().max(1000).nullish(),
  cwd: z.string().max(1000).nullish(),
  home: z.string().max(1000).nullish(),
  paths: z.array(z.string().max(1000)).max(20).default([]),
  agent: z.string().max(120).nullish(),
  sessionType: z.string().max(120).nullish(),
  branch: z.string().max(500).nullish(),
  sessionRef: z.string().max(500).nullish(),
});

export async function POST(request: Request) {
  try {
    return await withHiveBearerAuth(request, async (request, ctx, claims) => {
    const input = inputSchema.parse(await readJson(request));
    ctx = (await requireSelectedProject(ctx, input)).personal;
    await rateLimit("capture", `${ctx.teamId}/${ctx.memberId}`, 30, 60);
    const result = await withOrigin(originFor(ctx, "hook", claims ? "oauth" : "api_key"), async () => {
      const capture = await enforceCaptureRules(ctx, {title: "", body: input.text, repo: input.repo, remote: input.remote, cwd: input.cwd, home: input.home, paths: input.paths, agent: input.agent ?? "claude-code", sessionType: input.sessionType}, "hook", [input.branch, input.sessionRef].filter((value): value is string => Boolean(value)));
      if (capture.action === "drop") {
        const matched = capture.matches.find(match => match.action === "drop");
        if (!matched) throw new HiveError("Hive could not check what to keep. Try again.", 503);
        await recordEvent({name: "hook.fired", outcome: "skip", reasonCode: "capture_rule", properties: {hookKind: "stop", gateDecision: "skip", pushedCount: null}});
        return {decision: "skip" as const, dropped: true, rule: matched.kind, classification: null};
      }
      const result = await classifyCapture({...redactCaptureSecrets(input).input, text: capture.body});
      await recordEvent({
        name: "hook.fired",
        outcome: result.decision,
        properties: {
          hookKind: "stop",
          gateDecision: result.decision,
          worthSharingProbability:
            result.classification?.answers.worthSharing.noul,
          pushedCount: null,
        },
      });
      return {...result, redacted: capture.redacted, flagged: capture.flagged};
    });
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": `jev;dur=${result.classification?.latencyMs ?? 0}`,
      },
    });
    });
  } catch (error) {
    return httpError(error);
  }
}
