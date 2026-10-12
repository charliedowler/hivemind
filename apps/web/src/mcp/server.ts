import type { McpServer } from "@modelcontextprotocol/server";
import {
  hiveAskInput,
  hiveFeedbackInput,
  hivePushInput,
  hiveRecentInput,
  hiveSearchInput,
} from "@hivemind/core";

export function registerHiveTools(server: McpServer) {
  server.registerTool(
    "hive_push",
    {
      title: "Share a learning",
      description:
        "Call when you learn something non-obvious that would help a teammate. Share the context, evidence, and relevant repository. This tool is not wired yet.",
      inputSchema: hivePushInput,
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "hive_push is not wired yet. No learning was saved.",
        },
      ],
    }),
  );

  server.registerTool(
    "hive_search",
    {
      title: "Search shared learnings",
      description:
        "Call at the start of work in a repository and when an error appears. Find relevant learnings before repeating an investigation. This tool is not wired yet.",
      inputSchema: hiveSearchInput,
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "hive_search is not wired yet. No search was performed.",
        },
      ],
    }),
  );

  server.registerTool(
    "hive_ask",
    {
      title: "Ask the hive",
      description:
        "Call when you need a synthesized answer with citations to the team's shared learnings. This tool is not wired yet.",
      inputSchema: hiveAskInput,
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "hive_ask is not wired yet. No answer was generated.",
        },
      ],
    }),
  );

  server.registerTool(
    "hive_recent",
    {
      title: "Catch up on learnings",
      description:
        "Call to catch up on what the team has learned since a time or during a recent window. Optionally focus on one repository. This tool is not wired yet.",
      inputSchema: hiveRecentInput,
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "hive_recent is not wired yet. No learnings were retrieved.",
        },
      ],
    }),
  );

  server.registerTool(
    "hive_feedback",
    {
      title: "Review a learning",
      description:
        "Call after using a learning to vote it up, down, or outdated. Include a correction or context when helpful. This tool is not wired yet.",
      inputSchema: hiveFeedbackInput,
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "hive_feedback is not wired yet. No feedback was saved.",
        },
      ],
    }),
  );
}
