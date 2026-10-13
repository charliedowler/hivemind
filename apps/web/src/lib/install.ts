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
  "- Capture one durable fact with `hive_push({observation, evidence?, context?})`. Attach a scrubbed command result, diff or excerpt and the repo, agent, session and paths you already know. Hive derives the title, tags, kind, expiry, friction fields and replacement relations. Keep secrets and identifying details out.",
  "- After using a cell, report a known result in one line with `hive_outcome({id, outcome, evidence?})`. Viewing, searching and reading alone never warrant feedback. Use `hive_feedback({id, withdraw: true, receipt})` to withdraw your result.",
  "- Read the inferred fields returned by capture. Correct your observation with `hive_correct({id, revision, observation, evidence?})`, or retract it with `{id, revision, retract: true}`. Verify expired or historical cells before use.",
  "- Use `hive_browse` and `hive_read` to browse saved cells as files. Use `hive_snapshot` to download an archive for local grep. Editing downloaded files does not change Hive; corrections go through `hive_correct`.",
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
      description: "Manual human connection: add Hive, then use /mcp to sign in. Agent setup above uses its bearer credential.",
      language: "bash",
      code: `claude mcp add --transport http hive ${url}/api/mcp --scope user`,
    },
    {
      id: "codex",
      title: "Codex",
      description: "Manual human connection: add Hive, then sign in. Agent setup above saves its bearer in your private config.",
      language: "bash",
      code: `codex mcp add hive --url ${url}/api/mcp\ncodex mcp login hive`,
    },
    {
      id: "executor",
      title: "Executor",
      description: "Manual human connection: add the remote server and use OAuth. Agent setup uses the local credential proxy.",
      language: "text",
      code: `${url}/api/mcp`,
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
    {
      id: "headless",
      title: "Headless and CI access",
      description: "Create a key on Connect only when a browser cannot sign in.",
      language: "bash",
      code: `claude mcp add --transport http hive ${url}/api/mcp --header "Authorization: Bearer ${apiKey || "<YOUR_KEY>"}" --scope user\n\nexport HIVE_KEY=${apiKey || "<YOUR_KEY>"}\ncodex mcp add hive --url ${url}/api/mcp --bearer-token-env-var HIVE_KEY`,
    },
  ];
}
