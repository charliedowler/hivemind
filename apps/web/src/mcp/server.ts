import type { McpServer, AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  hiveAskInput,
  hiveFeedbackInput,
  hivePushInput,
  hiveRecentInput,
  hiveSearchInput,
  type HiveContext,
} from "@hivemind/core";
import {
  askHive,
  pushLearning,
  searchLearnings,
  recentLearnings,
  recordFeedback,
} from "@/server/hive";
import { HiveError } from "@/server/errors";

const contextSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  memberId: z.string(),
  memberName: z.string(),
});
type ToolContext = {
  http?: { authInfo?: AuthInfo; req?: { headers: Headers } };
};

function getContext(ctx: ToolContext): HiveContext {
  const parsed = contextSchema.safeParse(ctx.http?.authInfo?.extra);
  if (!parsed.success)
    throw new HiveError("A valid hive API key is required.", 401);
  return parsed.data;
}

function age(date: string): string {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  return minutes < 60
    ? `${minutes}m ago`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h ago`
      : `${Math.floor(minutes / 1440)}d ago`;
}

async function reply(action: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await action() }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            error instanceof HiveError
              ? error.message
              : "The hive could not complete this request. Try again.",
        },
      ],
    };
  }
}

export function registerHiveTools(server: McpServer) {
  server.registerTool(
    "hive_push",
    {
      title: "Share a learning",
      description:
        "Call when you learn something non-obvious that would help a teammate. Share context, evidence, and the repository. Include insights and friction: what slowed you down, measured minutes lost, whether progress was blocked, and a workaround. Never include secrets or customer names.",
      inputSchema: hivePushInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const userAgent =
          ctx.http?.req?.headers.get("user-agent")?.toLowerCase() ?? "";
        const source =
          input.source === "manual"
            ? userAgent.includes("claude")
              ? "claude-code"
              : userAgent.includes("codex")
                ? "codex"
                : "manual"
            : input.source;
        const result = await pushLearning(getContext(ctx), {
          ...input,
          source,
        });
        return `${result.merged ? `Merged into ${result.id} (seen ${result.pushCount} times)` : `Saved ${result.id}`}${result.redactions ? `\nRedacted ${result.redactions} secret${result.redactions === 1 ? "" : "s"}.` : ""}`;
      }),
  );

  server.registerTool(
    "hive_search",
    {
      title: "Search shared learnings",
      description:
        "Call at the start of work in a repository and when an error appears. Find relevant learnings before repeating an investigation. The repo boosts same-repository results; tags filter results.",
      inputSchema: hiveSearchInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const hits = await searchLearnings(getContext(ctx), input);
        if (!hits.length)
          return "No matching learnings yet. Use hive_push once you find the answer.";
        return hits
          .map(
            (hit, index) =>
              `${index + 1}. ${hit.id}: ${hit.title}\n${hit.kind} | ${hit.repo ?? "no repo"} | tags: ${hit.tags.join(", ") || "none"} | ${hit.author.name} via ${hit.source} | ${age(hit.lastPushedAt)} | votes: +${hit.votes.up} / -${hit.votes.down} / outdated ${hit.votes.outdated} | score ${hit.score.toFixed(2)}\n${hit.body.slice(0, 600)}${hit.body.length > 600 ? "…" : ""}`,
          )
          .join("\n\n");
      }),
  );

  server.registerTool(
    "hive_ask",
    {
      title: "Ask the hive",
      description:
        "Call for a synthesized answer with citations to the team's shared learnings. Read the confidence and gaps before acting.",
      inputSchema: hiveAskInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const result = await askHive(getContext(ctx), input);
        return `${result.answer}\n\nSources:\n${result.citations.map((citation) => `- ${citation.id}: ${citation.title}`).join("\n") || "None."}\n\nConfidence: ${result.confidence}\nGaps: ${result.gaps ?? "None reported."}`;
      }),
  );

  server.registerTool(
    "hive_recent",
    {
      title: "Catch up on learnings",
      description:
        "Call to catch up on what the team has learned since a time or during a recent window. Optionally filter to one repository.",
      inputSchema: hiveRecentInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const learnings = await recentLearnings(getContext(ctx), input);
        return (
          learnings
            .map(
              (learning) =>
                `- ${learning.id}: ${learning.title} | ${learning.author.name} via ${learning.source} | ${age(learning.lastPushedAt)} | ${learning.repo ?? "no repo"}`,
            )
            .join("\n") ||
          "No learnings in this time window. Use hive_push once you learn something useful."
        );
      }),
  );

  server.registerTool(
    "hive_feedback",
    {
      title: "Review a learning",
      description:
        "Call after using a learning to vote it up, down, or outdated. Include a correction or context when helpful.",
      inputSchema: hiveFeedbackInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const result = await recordFeedback(getContext(ctx), input);
        return `${result.id}: +${result.votes.up} / -${result.votes.down} / outdated ${result.votes.outdated}`;
      }),
  );
}
