export const setupPrompt =
  "Set me up on Hive: read https://gohive.dev/agent and follow it.";

export const signInGuidance = "Your agent starts a personal hive with your email. Claim it with one click when you’re ready.";

export const agentInstructions = `# Set up Hive

Run \`npx --yes gohive@latest install\` from the current repo; pass HIVE_EXECUTOR_TOOLS=1 when Executor tools are visible in this session.
If install returns offer_executor, ask its exact question once with the harness picker: Yes / Not now. Yes runs install --client executor; Not now runs install --skip-executor and continues normal setup.
Executor uses human OAuth, with no bootstrap credential or claim email. Relay its connection link: "Click it once to connect; then run npx gohive status." If already_connected, reuse it.
For quick_add with session tools: search for connections.list, integrations.list and mcp.getServer; describe and call them to check every remote MCP endpoint against the Hive URL. A healthy matching connection means "Hive is already connected in Executor"; a failed check means stop setup.
Otherwise reuse a matching app, or search for the add-app/Quick Add tool (mcp.addServer); describe and call it with name Hive, slug hive, remote URL https://gohive.dev/api/mcp (HIVE_URL + /api/mcp when set), and OAuth. Keep an occupied hive slug intact. This registers a remote MCP connection; never deploy code or create an Executor app or account for the person.
Search, describe and call OAuth probe, clients.list and (if needed) clients.registerDynamic, then oauth.start with owner user and an authorization_code client; relay the returned connection link. Credentials stay in secure links. After connection, follow Hive's server instructions for project selection and capture without hooks; stop the bootstrap steps below.
CLAUDECODE selects Claude Code; CODEX_* session markers (except CODEX_HOME) select Codex. Claude Code wins if both are present.
Without markers, configure only detected clients. Use --client only when the person selects other clients.
If the prompt includes a join link, add \`--join-url <joinUrl>\`.
The installer reads Git email and returns needs_email without changing config.
Ask with the harness's question/picker tool when one exists; otherwise a numbered list.
Use Claude Code's AskUserQuestion with options; use multiSelect for projects. In Codex use request_user_input or its question UI.
Ask "Use <detected email>?" with Yes / Type a different one; if none was found, ask which email to use.
Rerun install with \`--email <address>\` from the human's answer and the supplied join URL.
Hive issues an agent bearer credential. No browser opens in this path.
The installer announces the exact clients, backs up config, installs MCP and the skill, and adds capture hooks only for Claude Code.
A new owner starts privately while claim is pending. The email link claims the account and connects its agents to the owner's hives.
For an existing verified owner say "Click the link in your email to connect this machine"; status finishes after that click.
Run \`npx --yes gohive@latest status\` after claim to read join state.
A person who prefers OAuth can use \`gohive login\`.
If Hive is already installed and signed in, reuse it; never reinstall to join.
If tools are absent outside requested setup, run status once, never the installer.
If installed and signed in say exactly: "Hive is set up but not loaded in this session; restart Codex (or run /mcp in Claude Code) to use it" and continue without Hive.
If not installed, offer setup in one line and do nothing else.
Never announce installation or print the join prompt outside an actual install.
If latest resolves to a missing version, retry once with the version status printed, then give up quietly.
If npm's min-release-age blocks gohive, ask the person before overriding it, and point them at the public source: https://github.com/charliedowler/hivemind
Read \`hive_share_projects { revision: 0 }\`; if selected, skip the project question.
Otherwise detect cwd, Git remotes and known worktrees only. Do not scan home directories or transcripts.
Include "everything under github.com/<org>" choices when remotes share an organisation, using github.com/<org>/*.
Ask once with the native multi-select picker: "Which projects should Hive learn from? Anything else stays private."
Save include/exclude and humanInstruction at the read revision. Without an answer or existing selection, capture nothing.
Joining never publishes. Read \`hive_agent_status\` after claim.
For each completed join ask once with the native picker: "Share your learnings with <Team>?"
Options: Yes (everything selected, now and in future), Choose projects, Not now.
Choose projects uses a multi-select list with cell counts, never pre-ticked.
Use \`hive_share_with\` with mode all_selected, projects, or not_now and the humanInstruction.
Originals stay personal; Yes covers future selected projects too.
During setup only, call hive_invite_link and give the team prompt once.
Save a proven fix, decision, pitfall or measured friction immediately through hive_push with repo and evidence.
Keep the Jev gate; avoid duplicates and sensitive data. Stop is a safety net.
Never ask the human to sign up, create an organisation, or add authority steps.
`;

export function teamInvitePrompt(team: string, joinUrl: string) {
  const instructionsUrl = new URL("/agent", joinUrl).href;
  return `Set me up on Hive and join the ${team} hive: read ${instructionsUrl} and follow it, then join with ${joinUrl}`;
}
