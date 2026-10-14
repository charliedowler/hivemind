import { cliVersionInstructions } from "@/lib/cli-version";
import type { McpServer } from "@modelcontextprotocol/server";
import { hiveRecentInput } from "@hivemind/core";
import { recentLearnings, teamOverview } from "@/server/hive";
import { ownerCapturePolicy } from "@/server/project-sharing";
import { HiveError } from "@/server/errors";
import { withMcpContext } from "./context";
import { hiveInviteLink } from "./invites";

export function registerHiveResources(server: McpServer) {
  server.registerResource(
    "overview",
    "hive://overview",
    {
      title: "Hive overview",
      description:
        "Selected hive, counts, capture policy and capture state.",
      mimeType: "text/markdown",
    },
    async (uri, ctx) =>
      withMcpContext(ctx, async (actor) => {
        const overview = await teamOverview(actor);
        let projects = "Unavailable for this identity.";
        try {
          const policy = await ownerCapturePolicy(actor);
          projects = `${policy.mode === "everything" ? "Captures from every Git repository with a remote" : `Captures only from: ${JSON.stringify(policy.include)}`}\nExcluded: ${JSON.stringify(policy.exclude)}${policy.workAreas ? `\nWork areas: ${policy.workAreas}` : ""}`;
        } catch (error) {
          if (!(error instanceof HiveError) || error.status !== 403)
            throw error;
        }
        const invite = await hiveInviteLink(actor);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `# ${overview.teamName}\n\nMembers: ${overview.memberCount}\nCells: ${overview.learningCount}\n\n## Installer updates\n\n${cliVersionInstructions}\n\n## Capture\n\n${projects}\n\nChat capture: disabled; captures without repository context are refused.\n\n## Invite teammates\n\n\`\`\`json\n${JSON.stringify(invite, null, 2)}\n\`\`\`\n`,
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
