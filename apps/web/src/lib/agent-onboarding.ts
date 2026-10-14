export const setupPrompt =
  "Set me up on Hive: read https://gohive.dev/agent and follow it.";

export const signInGuidance = "Your agent starts a personal hive with your email. Claim it with one click when you’re ready.";

export const agentInstructions = `# Set up Hive

Run \`npx --yes gohive@latest install\` from the current repo; pass HIVE_EXECUTOR_TOOLS=1 when Executor tools are visible in this session.
If install returns offer_executor, ask its exact question once with the harness picker: Yes / Not now. Yes runs install --client executor; Not now runs install --skip-executor and continues normal setup.
Executor uses human OAuth, with no bootstrap credential or claim email. Relay its connection link: "Click it once to connect; then run npx gohive status." If already_connected, reuse it.
For quick_add with session tools: search for connections.list, integrations.list and mcp.getServer; describe and call them to check every remote MCP endpoint against the Hive URL. A healthy matching connection means "Hive is already connected in Executor"; a failed check means stop setup.
Otherwise reuse a matching app, or search for the add-app/Quick Add tool (mcp.addServer); describe and call it with name Hive, slug hive, remote URL https://gohive.dev/api/mcp (HIVE_URL + /api/mcp when set), and OAuth. Keep an occupied hive slug intact. This registers a remote MCP connection; never deploy code or create an Executor app or account for the person.
Search, describe and call OAuth probe, clients.list and (if needed) clients.registerDynamic, then oauth.start with owner user and an authorization_code client; relay the returned connection link. Credentials stay in secure links. After connection, follow Hive's server instructions for capture without hooks; stop the bootstrap steps below.
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
After install, if the Hive tools are not loaded in this session, say only the installer's next_steps line, e.g. "Two steps left: click the link in your email, then run /mcp in Claude Code (or restart Codex). I'll finish setting up Hive after that." Then stop.
Ask the work-areas, exclude or project, and share questions only when the Hive tools are loaded and the answer can be saved with the next tool call. Ask each at most once per setup.
Run \`npx --yes gohive@latest status\` after claim to read join state.
A person who prefers OAuth can use \`gohive login\`.
If Hive is already installed and signed in, reuse it; never reinstall to join.
If tools are absent outside requested setup, run status once, never the installer.
If installed and signed in say exactly: "Hive is set up but not loaded in this session; restart Codex (or run /mcp in Claude Code) to use it" and continue without Hive.
If not installed, offer setup in one line and do nothing else.
Never announce installation or print the join prompt outside an actual install.
If latest resolves to a missing version, retry once with the version status printed, then give up quietly.
If npm's min-release-age blocks gohive, ask the person before overriding it, and point them at the public source: https://github.com/charliedowler/hivemind
Hive captures by default: learnings from Git repositories with a remote that this agent works in go to the person's personal hive. Nothing reaches a team until they choose to share. Repos without a remote and home directories capture nothing.
Once the tools are loaded, tell the person once, in one line: "Hive learns privately from the repos you work in. Say 'not this repo' to exclude one, or name the repos to learn from only those."
Read \`hive_share_projects { revision: 0 }\`; if workAreas is set, skip the next question.
Ask once with the harness picker, Skip as an option and a typed answer as free text (AskUserQuestion's Other field in Claude Code): "What kinds of things do you work on that Hive can learn from? Type a few areas, or skip."
Save a typed answer as workAreas with humanInstruction at the read revision. It tags captures and suggests what to share; it never limits capture.
Choosing projects is optional. To exclude a repo, save exclude. For an allow-list, save mode selected with include, offering "everything under github.com/<org>" choices (github.com/<org>/*). Detect only cwd, Git remotes and known worktrees; never scan home directories or transcripts.
Joining alone never publishes. Read \`hive_agent_status\` after claim.
Ask the share question only after hive_agent_status shows the join completed and lists its share offer. For each offer, ask once with the native picker using the offer's question (e.g. "Share your learnings about frontend React, dbt models and infra with Lightdash?") and its explanation.
Options in this order: Yes (Recommended): everything Hive captures for you, now and in future; Choose projects; Not now.
Choose projects uses a multi-select list with cell counts, never pre-ticked.
Use \`hive_share_with\` with mode all_selected for Yes, projects for the picked projects, or not_now, with the human's words as humanInstruction.
Originals stay personal; the person can change this later on the Team page.
During setup only, call hive_invite_link and give the team prompt once.
Once setup is complete and the Hive tools are loaded, backfill before continuing: in the current repo (and any other repo Hive may learn from: every repo with a Git remote minus exclusions, or only the selected list) read the last few days of history with \`git log --since='4 days ago' --stat -p\` on the current branch plus recently merged commits, and capture each proven fix, decision, pitfall or reversed approach you find through hive_push, with the commit hash and paths as evidence and the usual context. Skip excluded repos, repos without a remote, secrets, and anything already in Hive (search first). Then tell the person in one line how many cells you saved from the backfill.
Save a proven fix, decision, pitfall or measured friction immediately through hive_push with repo and evidence.
Keep the Jev gate; avoid duplicates and sensitive data. Stop is a safety net.
Never ask the human to sign up, create an organisation, or add authority steps.
`;

export function teamInvitePrompt(team: string, joinUrl: string) {
  const instructionsUrl = new URL("/agent", joinUrl).href;
  return `Set me up on Hive and join the ${team} hive: read ${instructionsUrl} and follow it, then join with ${joinUrl}`;
}
