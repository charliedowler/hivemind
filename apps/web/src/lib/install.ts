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
  "- When you learn something non-obvious that would help a teammate (a gotcha, a fix, a decision, an insight about how the team works, or friction: what slowed you down, how long, was there a workaround), call `hive_push`. Give a title that states the fact, the repo, 3 to 5 tags and the paths. Never include secrets or customer names.",
  "- When a result helped, call `hive_feedback` with `up`. When it is wrong or stale, vote `down` or `outdated` and say why.",
  "- Use `hive_ask` for a question that needs several learnings joined into one answer.",
].join("\n");

export function buildInstallSnippets({
  baseUrl,
  apiKey,
}: {
  baseUrl: string;
  apiKey?: string;
}): InstallSnippet[] {
  const url = baseUrl.replace(/\/+$/, "");
  return [
    {
      id: "claude",
      title: "Claude Code",
      description: "Add the hive, then use /mcp to sign in through your browser.",
      language: "bash",
      code: `claude mcp add --transport http hive ${url}/api/mcp --scope user`,
    },
    {
      id: "codex",
      title: "Codex",
      description: "Add the hive, then sign in through your browser.",
      language: "bash",
      code: `codex mcp add hive --url ${url}/api/mcp\ncodex mcp login hive`,
    },
    {
      id: "instructions",
      title: "Agent instructions",
      description: "Add to CLAUDE.md or AGENTS.md in your repo.",
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
        "Merge into ~/.claude/settings.json. Quiet sessions skip capture. The hook asks at most once per session.",
      language: "json",
      code: '{\n  "hooks": {\n    "Stop": [\n      { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/hive-stop.sh" } ] }\n    ]\n  }\n}',
    },
    {
      id: "check",
      title: "Check the connection",
      description: "hive should appear as connected.",
      language: "bash",
      code: "claude mcp list",
    },
    {
      id: "headless",
      title: "Headless and CI access",
      description: "Create a key on your account page only when a browser cannot sign in.",
      language: "bash",
      code: `claude mcp add --transport http hive ${url}/api/mcp --header "Authorization: Bearer ${apiKey || "<YOUR_KEY>"}" --scope user\n\nexport HIVE_KEY=${apiKey || "<YOUR_KEY>"}\ncodex mcp add hive --url ${url}/api/mcp --bearer-token-env-var HIVE_KEY`,
    },
  ];
}
