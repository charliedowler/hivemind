export const setupPrompt =
  "Set me up on Hive: read https://gohive.dev/agent and follow it.";

export const signInGuidance =
  "If a person is present, sign in as them with one click; use agent identity only when no human is at the keyboard.";

export const agentInstructions = `# Set up Hive

Before running the installer, name exactly the selected clients in one line: “Installing Hive for <clients>: the MCP server, a skill, and capture hooks that only act on projects you choose; your config is backed up first.”
CLAUDECODE selects Claude Code; CODEX_* session markers (except CODEX_HOME) select Codex. Claude Code wins if both are present.
Use “Installing Hive for Claude Code” in Claude Code and “Installing Hive for Codex” in Codex; mention capture hooks only for Claude Code.
Without session markers, install configures the clients detected on the machine and announces “(detected on this machine)”.
Use \`--client claude\`, \`--client codex\`, \`--client all\` or \`--client claude,codex\` only when the person selects them explicitly.
Run \`npx gohive@latest install\` from the current repo.
If the setup prompt includes a join link, add \`--join-url <joinUrl>\` to the install command.
If a person is present, sign in as them with one click; use agent identity only when no human is at the keyboard.
It opens a browser tab. Tell the person: “Sign in with Google in the tab that just opened.”
Continue when \`gohive status\` reports signed in.
Use agent identity only when no person is at the keyboard: \`npx gohive@latest install --identity agent\`.
After sign-in, run \`npx gohive status\` to finish joining; if Hive tools are not loaded in Claude Code, run \`/mcp\` to reconnect Hive. Never create an AgentMail inbox for a person.
Claude Code uses the same sign-in for MCP and hooks. Reconnect Hive in \`/mcp\` after status succeeds; a second OAuth sign-in is not needed.
Codex keeps its native \`codex mcp login hive\` connection.
If Hive is already installed and signed in, reuse that setup.
Read the current project selection with \`hive_share_projects { revision: 0 }\`.
If a selection exists, keep it and skip the project question.
Otherwise list candidates from cwd, Git remotes and known Git worktrees only.
Ask once: “Which of these should Hive learn from? <list>. Anything else stays private.”
Save the answer with \`hive_share_projects\`, supplying include, exclude,
revision from the read, and humanInstruction containing the human’s answer.
Use canonical host/namespace/repo patterns. Do not scan home directories or transcripts.
Without a human answer or an existing selection, capture nothing.
Selected projects may be captured into the owner’s personal hive.
Save a cell with \`hive_push\` as soon as you learn a fix, decision, pitfall or measured friction.
Supply the repo and the evidence that supports it.
Hive saves when something is learned, not when a session ends.
Use session-end and compaction sweeps as a safety net; avoid duplicate cells.
Project selection does not publish cells to an organisation.
If the setup prompt includes a join link, take its phrase from /j/<phrase>.
Call \`hive_join { phrase: "<phrase>" }\` after project selection.
On \`needs_human\`, say exactly one line: “Open <joinUrl> to join <team>”.
Use the team name supplied by the human’s prompt; never guess one from the phrase.
A human token or human-granted capability may complete joining immediately.
Do not ask the human to sign up. Do not create an organisation.
Do not widen project selection or publish cells without human authority.
Report completed setup in one line. Report a genuine blocker in one line.
`;

export function teamInvitePrompt(team: string, joinUrl: string) {
  return `Set me up on Hive and join the ${team} hive: read https://gohive.dev/agent and follow it, then join with ${joinUrl}`;
}
