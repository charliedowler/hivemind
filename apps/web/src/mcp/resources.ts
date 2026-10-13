import type { McpServer } from "@modelcontextprotocol/server";
import { hiveRecentInput } from "@hivemind/core";
import { recentLearnings, teamOverview } from "@/server/hive";
import { ownerCapturePolicy } from "@/server/project-sharing";
import { adminJoinPhrase } from "@/server/identity/join-phrases";
import { isAgentMember } from "@/server/identity/agent-enrollment";
import { HiveError } from "@/server/errors";
import { withMcpContext } from "./context";
import { getSql } from "@/server/db/client";

export function registerHiveResources(server: McpServer) {
  server.registerResource(
    "overview",
    "hive://overview",
    {
      title: "Hive overview",
      description:
        "Selected hive, counts, selected projects and capture state.",
      mimeType: "text/markdown",
    },
    async (uri, ctx) =>
      withMcpContext(ctx, async (actor) => {
        const overview = await teamOverview(actor);
        let projects = "Unavailable for this identity.";
        try {
          const policy = await ownerCapturePolicy(actor);
          projects = `Included: ${JSON.stringify(policy.include)}\nExcluded: ${JSON.stringify(policy.exclude)}`;
        } catch (error) {
          if (!(error instanceof HiveError) || error.status !== 403)
            throw error;
        }
        let phrase = null;
        if (
          overview.role === "admin" &&
          !(await isAgentMember(actor.memberId))
        ) {
          const [hive] =
            await getSql()`SELECT personal_owner_member_id FROM teams WHERE id = ${actor.teamId}`;
          if (hive?.personal_owner_member_id === null)
            phrase = await adminJoinPhrase(actor);
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `# ${overview.teamName}\n\nMembers: ${overview.memberCount}\nCells: ${overview.learningCount}\n\n## Selected projects\n\n${projects}\n\nChat capture: disabled; captures without selected project context are refused.\n${phrase ? `\nJoin phrase: ${phrase.phrase}${phrase.paused ? " (paused)" : ""}\n` : ""}`,
            },
          ],
        };
      }),
  );
  server.registerResource(
    "recent",
    "hive://recent",
    {
      title: "Recent Hive cells",
      description: "The last 20 visible cells, with titles and IDs.",
      mimeType: "text/markdown",
    },
    async (uri, ctx) =>
      withMcpContext(ctx, async (actor) => {
        const cells = await recentLearnings(
          actor,
          hiveRecentInput.parse({
            since: "1970-01-01T00:00:00Z",
            limit: 20,
            include_history: false,
          }),
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `# Recent cells\n\n${cells.map((cell) => `- ${cell.id}: ${cell.title}`).join("\n") || "No visible cells yet."}`,
            },
          ],
        };
      }),
  );
}
