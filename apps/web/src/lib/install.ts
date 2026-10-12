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
  "- When you learn something non-obvious that would help a teammate (a gotcha, a fix, a decision, how a flaky thing really works), call `hive_push`. Give a title that states the fact, the repo, 3 to 5 tags and the paths. Never include secrets or customer names.",
  "- When a result helped, call `hive_feedback` with `up`. When it is wrong or stale, vote `down` or `outdated` and say why.",
  "- Use `hive_ask` for a question that needs several learnings joined into one answer.",
].join("\n");

const stopHook = (url: string) =>
  [
    "#!/usr/bin/env bash",
    "input=$(cat)",
    "if printf '%s' \"$input\" | grep -q '\"stop_hook_active\"[[:space:]]*:[[:space:]]*true'; then exit 0; fi",
    'session=$(printf \'%s\' "$input" | sed -n \'s/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\')',
    'marker="${TMPDIR:-/tmp}/hive-stop-${session:-unknown}"',
    '[ -e "$marker" ] && exit 0',
    ': > "$marker"',
    'ending="If nothing qualifies, stop now without comment."',
    'if [ "${CLAUDE_CODE_ENTRYPOINT:-cli}" != "cli" ]; then',
    '  ending="This is a headless run and the caller reads only your last message, so finish by repeating your previous final answer word for word and nothing else."',
    "fi",
    `printf '%s\\n' \"{\\\"decision\\\":\\\"block\\\",\\\"reason\\\":\\\"Before you stop: if this session taught you something a teammate's agent would otherwise have to rediscover (a gotcha, a fix, a decision, how this project, its tools or its CI really behave), use the Hive MCP server at ${url}/api/mcp to call hive_push once per learning with a title that states the fact, the repo and 3 to 5 tags. Skip general knowledge any agent already has. $ending\\\"}\"`,
    "",
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
      description: "Add to CLAUDE.md or AGENTS.md in your repo.",
      language: "markdown",
      code: instructions,
    },
    {
      id: "stop-script",
      title: "Claude Code Stop hook · script",
      description:
        "Save as ~/.claude/hooks/hive-stop.sh, then run chmod +x ~/.claude/hooks/hive-stop.sh.",
      language: "bash",
      code: stopHook(url),
    },
    {
      id: "stop-settings",
      title: "Claude Code Stop hook · settings",
      description:
        "Merge into ~/.claude/settings.json. The hook asks once per session.",
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
  ];
}
