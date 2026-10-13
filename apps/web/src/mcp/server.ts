import { cellStateLabel, kindLabel } from "@/lib/learning-presentation";
import {
  withOrigin,
  originFor,
  bindApiKey,
  bindRole,
} from "@/server/analytics/events";
import type { McpServer, AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  hiveShareProjectsInput,
  hiveJoinInput,
  hiveSlackSearchInput,
  hiveBrowseInput,
  hiveReadInput,
  hiveAskInput,
  hiveFeedbackInput,
  hivePushInput,
  hiveCorrectInput,
  hiveOutcomeInput,
  hiveRecentInput,
  hiveSearchInput,
  type HiveContext,
  type LearningView,
} from "@hivemind/core";
import {
  askHive,
  pushLearning,
  searchLearnings,
  recentLearnings,
  recordFeedback,
} from "@/server/hive";
import {
  browseKnowledge,
  readKnowledge,
  snapshotKnowledge,
} from "@/server/knowledge-tree";
import { HiveError } from "@/server/errors";

import { correctLearning } from "@/server/lifecycle";
import { reportOutcome } from "@/server/feedback";
import { reverseDecision } from "@/server/conflict-decisions";

import { shareProjects } from "@/server/project-sharing";
import { mcpJoin } from "@/server/identity/mcp-join";

import { searchSlack } from "@/server/slack/search";

const contextSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  apiKeyId: z.string().nullish(),
  role: z.enum(["admin", "member"]).nullish(),
  sessionKind: z.enum(["api_key", "oauth"]).optional(),
  trustedProxyIp: z.string().nullable().optional(),
});
type ToolContext = {
  http?: { authInfo?: AuthInfo; req?: { headers: Headers } };
};

function getContext(ctx: ToolContext): HiveContext {
  const parsed = contextSchema.safeParse(ctx.http?.authInfo?.extra);
  if (!parsed.success)
    throw new HiveError("Connect your agent to the hive and sign in.", 401);
  const actor = parsed.data;
  if (actor.apiKeyId) bindApiKey(actor, actor.apiKeyId);
  if (actor.role) bindRole(actor, actor.role);
  return actor;
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

function cellStatusText(cell: LearningView) {
  const state = cellStateLabel(cell);
  const parts = [
    cell.supersededBy ? `Replaced by ${cell.supersededBy}` : state,
    cell.verifyBeforeUse ? "Check this is still true" : undefined,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" | ")} | ` : "";
}

async function reply(action: () => Promise<string>, ctx: ToolContext) {
  try {
    return {
      content: [
        {
          type: "text" as const,
          text: await withOrigin(
            originFor(
              getContext(ctx),
              "mcp",
              contextSchema.parse(ctx.http?.authInfo?.extra).sessionKind,
            ),
            action,
          ),
        },
      ],
    };
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
  server.registerTool("hive_share_projects", {
    title: "Choose projects for private capture",
    description: "Read the owner's selection, or save include/exclude patterns at its revision. Initial agent setup records the supplied humanInstruction. Adding projects later requires human authority. Captures stay personal; this never publishes to an organisation.",
    inputSchema: hiveShareProjectsInput,
  }, async (input, ctx) => reply(async () => {
    const policy = await shareProjects(getContext(ctx), input);
    return JSON.stringify(policy);
  }, ctx));
  server.registerTool("hive_join", {
    title: "Join an organisation hive",
    description: "Join by its domain-gated phrase using a human sign-in or live human-granted capability. Otherwise returns the owner's human join link. Joining never publishes projects.",
    inputSchema: hiveJoinInput,
  }, async (input, ctx) => reply(async () => {
    const auth = contextSchema.parse(ctx.http?.authInfo?.extra);
    return JSON.stringify(await mcpJoin(getContext(ctx), input.phrase, {trustedProxyIp: auth.trustedProxyIp ?? null, sessionKind: auth.sessionKind}));
  }, ctx));
  server.registerTool(
    "hive_slack_search",
    {
      title: "Search permitted Slack channels",
      description:
        "Search messages from Slack channels the hive admin selected. Never searches direct messages. Returns original permalinks.",
      inputSchema: hiveSlackSearchInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const hits = await searchSlack(getContext(ctx), input);
        return (
          hits
            .map(
              (h) =>
                `${h.id}: ${h.title}\nsource: slack | #${h.slackChannel} | ${h.author.name} | score ${h.score.toFixed(2)}\n${h.permalink}\n${h.body.slice(0, 1000)}`,
            )
            .join("\n\n") || "No matching messages in permitted Slack channels."
        );
      }, ctx),
  );
  server.registerTool(
    "hive_browse",
    {
      title: "Browse hive files",
      description:
        "List the team's saved cells as files and directories. Start with an empty path.",
      inputSchema: hiveBrowseInput,
    },
    async (input, ctx) =>
      reply(
        async () =>
          JSON.stringify(await browseKnowledge(getContext(ctx), input.path)),
        ctx,
      ),
  );
  server.registerTool(
    "hive_read",
    {
      title: "Read a hive file",
      description:
        "Read a Markdown file from the team's saved files. Historical cells carry replacement pointers and verification dates.",
      inputSchema: hiveReadInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const file = await readKnowledge(getContext(ctx), input.path);
        return `Revision ${file.revision}: ${file.path}\n\n${file.content}`;
      }, ctx),
  );
  server.registerTool(
    "hive_snapshot",
    {
      title: "Export hive archive",
      description:
        "Get a private tar.gz download URL valid for 15 minutes. Unpack it to search saved cells locally. Treat the URL as a credential. Edits go through hive_push.",
      inputSchema: z.object({}),
    },
    async (_input, ctx) =>
      reply(
        async () => JSON.stringify(await snapshotKnowledge(getContext(ctx))),
        ctx,
      ),
  );

  server.registerTool(
    "hive_push",
    {
      title: "Share a learning",
      description:
        "Share one observation in your words, optional evidence and the runtime context you already know. Hive derives the title, metadata and relations. Returns the saved cell, inferred fields and a revision-bound correction handle. Keep secrets and identifying details out.",
      inputSchema: hivePushInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const userAgent =
          ctx.http?.req?.headers.get("user-agent")?.toLowerCase() ?? "";
        const source = input.source ?? (input.context?.agent === "codex" || input.agent === "codex" || userAgent.includes("codex") ? "codex" : input.context?.agent === "claude-code" || input.agent === "claude-code" || userAgent.includes("claude") ? "claude-code" : "manual");
        const result = await pushLearning(getContext(ctx), {
          ...input,
          source,
          agent: input.agent ?? input.context?.agent ?? (userAgent.includes("executor") ? "executor" : source),
        });
        return JSON.stringify(result.dropped ? result : {
          ...result,
          cellUrl: `/app/cells/${result.id}`,
        });
      }, ctx),
  );

  server.registerTool("hive_correct", {
    title: "Correct or remove your cell",
    description: "Correct the observation or remove the cell. Use the saved revision. Authors and team admins can edit; the change preserves audit history.",
    inputSchema: hiveCorrectInput,
  }, async (input, ctx) => reply(async () => JSON.stringify(await correctLearning(getContext(ctx), input)), ctx));
  server.registerTool("hive_outcome", {
    title: "Report a result from using a cell",
    description: "Report a concrete result from using this cell, with evidence when available. Hive classifies useful, contradicted, stale or inconclusive. Useful results raise ranking; contradicted and stale results can hide cells from default retrieval. Retrieval alone never votes. Returns an actor-bound receipt you can withdraw with hive_feedback.",
    inputSchema: hiveOutcomeInput,
  }, async (input, ctx) => reply(async () => JSON.stringify(await reportOutcome(getContext(ctx), input)), ctx));

  server.registerTool(
    "hive_search",
    {
      title: "Search shared learnings",
      description:
        "Call at the start of work in a repository and when an error appears. Find relevant learnings before repeating an investigation. The repo boosts same-repository results; tags filter results. Unhelpful and contradicted cells are hidden by default, along with outdated, superseded and retracted cells. Use include_history: true to investigate them.",
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
              `${index + 1}. ${hit.id}: ${hit.title}\n${cellStatusText(hit)}${kindLabel(hit.kind)} | ${hit.repo ?? "no repo"} | tags: ${hit.tags.join(", ") || "none"} | ${hit.author.name} via ${hit.source} | ${age(hit.lastPushedAt)} | votes: +${hit.votes.up} / -${hit.votes.down} / outdated ${hit.votes.outdated} | score ${hit.score.toFixed(2)}\n${hit.permalink ? `Source: slack ${hit.permalink}\n` : ""}${hit.body.slice(0, 600)}${hit.body.length > 600 ? "…" : ""}`,
          )
          .join("\n\n");
      }, ctx),
  );

  server.registerTool(
    "hive_ask",
    {
      title: "Ask the hive",
      description:
        "Ask a question using the team's saved learnings. The answer cites its cells. Check the confidence and gaps before acting. Unhelpful and contradicted cells are hidden by default, along with outdated, superseded and retracted cells. Use include_history: true to investigate them.",
      inputSchema: hiveAskInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const result = await askHive(getContext(ctx), input);
        return `${result.answer}\n\nSources:\n${result.citations.map((citation) => `- ${citation.id}: ${citation.title}${citation.permalink ? ` (source: slack) ${citation.permalink}` : ""}`).join("\n") || "None."}\n\nConfidence: ${result.confidence}\nGaps: ${result.gaps ?? "None reported."}`;
      }, ctx),
  );

  server.registerTool(
    "hive_recent",
    {
      title: "Catch up on learnings",
      description:
        "List what the team learned since a date or during a time window. Use repo to limit results to one repository. Unhelpful and historical cells are hidden by default; include_history: true shows them.",
      inputSchema: hiveRecentInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const learnings = await recentLearnings(getContext(ctx), input);
        return (
          learnings
            .map(
              (learning) =>
                `- ${learning.id}: ${learning.title} | ${cellStatusText(learning)}${learning.author.name} via ${learning.source} | ${age(learning.lastPushedAt)} | ${learning.repo ?? "no repo"}`,
            )
            .join("\n") ||
          "No learnings in this time window. Use hive_push once you learn something useful."
        );
      }, ctx),
  );

  server.registerTool(
    "hive_reverse_decision",
    {
      title: "Reverse a decision",
      description: "Reverse a cell change immediately by its decision ID. Requires a team admin and unchanged cells. Returns the new decision ID; reverse that ID to undo. Older changes without saved cell copies cannot be reversed.",
      inputSchema: z.object({ decision_id: z.string().min(1).max(100) }),
    },
    async (input, ctx) => reply(async () => {
      const actor = getContext(ctx);
      const result = await reverseDecision(actor, input.decision_id, undefined, undefined, "through MCP");
      return `${result.id}: ${result.decision === "reversed" ? "Cell change reversed." : "Cell change reapplied."}`;
    }, ctx),
  );

  server.registerTool(
    "hive_feedback",
    {
      title: "Review a learning",
      description:
        "Optional direct useful, unhelpful or outdated vote. Prefer hive_outcome for an evidenced result. Use withdraw: true and the receipt to withdraw your feedback. Votes change ranking and inclusion in default search, ask and recent. The newest feedback replaces your prior vote; retrieval never votes.",
      inputSchema: hiveFeedbackInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const result = await recordFeedback(getContext(ctx), input);
        return JSON.stringify(result);
      }, ctx),
  );
}
