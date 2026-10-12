import { buildStopHook } from "./stop-hook";

export type InstallSnippet = {
  id: string;
  title: string;
  description: string;
  language: string;
  code: string;
};

const instructions = [
  "## Hive (team memory)",
  "- When you start work in a repo, call `hive_search` with the task in a few words and the repo as `owner/name`.",
  "- When you hit an error you do not understand, call `hive_search` with the error text before you investigate.",
  "- Call `hive_push` when you learn something a teammate would otherwise need to rediscover. This includes gotchas, fixes, decisions and insights about how the team works. For friction, describe what slowed you down, how long it took and any workaround. Use a title that states the fact. Include the repo, 3 to 5 tags and relevant paths. Keep secrets and customer names out.",
  "- When a result helped, call `hive_feedback` with `up`. When it is wrong or stale, vote `down` or `outdated` and say why.",
  "- Before pushing a correction, search for and read the old cell. Set `supersedes` to its id so the replacement becomes current and the old source stays in history. Set `verify_after` to an ISO date for time-sensitive facts; check expired cells before use.",
  "- Use `hive_browse` and `hive_read` to explore the read-only knowledge tree. Use `hive_snapshot` to download an archive for local grep. Tree edits are not saved; corrections go through `hive_push`.",
  "- Use `hive_ask` for a question that needs several learnings joined into one answer.",
].join("\n");

export function buildInstallSnippets({
  baseUrl,
  apiKey,
}: {
  baseUrl: string;
  apiKey: string;
}): InstallSnippet[] {
  const url = baseUrl.replace(/\/+$/, "");
  return [
    {
      id: "claude",
      title: "Claude Code",
      description: "Add the hive to every Claude Code session.",
      language: "bash",
      code: `claude mcp add --transport http hive ${url}/api/mcp --header "Authorization: Bearer ${apiKey}" --scope user`,
    },
    {
      id: "codex",
      title: "Codex",
      description: "Add the export line to ~/.zshrc so new shells have it.",
      language: "bash",
      code: `export HIVE_KEY=${apiKey}\ncodex mcp add hive --url ${url}/api/mcp --bearer-token-env-var HIVE_KEY`,
    },
    {
      id: "instructions",
      title: "Agent instructions",
      description: "Add these instructions to CLAUDE.md or AGENTS.md in your repo.",
      language: "markdown",
      code: instructions,
    },
    {
      id: "stop-script",
      title: "Claude Code Stop hook · script",
      description:
        "Save as ~/.claude/hooks/hive-stop.sh, then run chmod +x ~/.claude/hooks/hive-stop.sh. Requires Node 20 or later.",
      language: "bash",
      code: buildStopHook(url),
    },
    {
      id: "stop-settings",
      title: "Claude Code Stop hook · settings",
      description:
        "Add these settings to ~/.claude/settings.json. The hook skips quiet sessions and asks at most once per session.",
      language: "json",
      code: '{\n  "hooks": {\n    "Stop": [\n      { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/hive-stop.sh" } ] }\n    ]\n  }\n}',
    },
    {
      id: "check",
      title: "Check the connection",
      description: "Check that hive appears as connected.",
      language: "bash",
      code: "claude mcp list",
    },
  ];
}
