import { cellStateLabel, kindLabel } from "@/lib/learning-presentation";
import {
  withOrigin,
  originFor,
} from "@/server/analytics/events";
import type { McpServer } from "@modelcontextprotocol/server";
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
import { contextSchema, getContext, type ToolContext } from "./context";
import { registerHiveInstructions } from "./instructions";
import { registerHivePrompts } from "./prompts";
import { registerHiveResources } from "./resources";
import { hiveInviteLink } from "./invites";


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
  registerHiveInstructions(server);
  registerHivePrompts(server);
  registerHiveResources(server);
  server.registerTool("hive_invite_link", {
    title: "Invite teammates to this hive",
    description: "Get the current organisation's domain-gated join link and setup prompt, or the personal hive's team-creation link.",
    inputSchema: z.strictObject({}),
  }, async (_input, ctx) => reply(async () => JSON.stringify(await hiveInviteLink(getContext(ctx))), ctx));
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
        "Save a requested durable observation with evidence and known project context, without secrets or personal data; explain any capture refusal.",
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
    description: "Report an evidenced result after using a cell so Hive can update its ranking and inclusion; reading alone never votes.",
    inputSchema: hiveOutcomeInput,
  }, async (input, ctx) => reply(async () => JSON.stringify(await reportOutcome(getContext(ctx), input)), ctx));

  server.registerTool(
    "hive_search",
    {
      title: "Search shared learnings",
      description:
        "Search team memory before answering about code, tools or decisions and cite the cells; include_history reveals hidden unhelpful or historical cells.",
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
        "Answer from team memory with cell citations, confidence and gaps; include_history reveals hidden unhelpful or historical cells.",
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
        "Vote up for useful, down for unhelpful or outdated for stale cells to change ranking and inclusion, or withdraw your receipt; prefer hive_outcome for evidence.",
      inputSchema: hiveFeedbackInput,
    },
    async (input, ctx) =>
      reply(async () => {
        const result = await recordFeedback(getContext(ctx), input);
        return JSON.stringify(result);
      }, ctx),
  );
}
