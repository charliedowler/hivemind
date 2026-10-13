# Connect a coding agent to Hive

Hive issues the agent credential. People still use Google, Slack or email with OAuth.

## Install

Run `npx --yes gohive@latest install` in the repository. The first run reads Git email and returns a structured question without changing config. Ask with the harness's question/picker tool when one exists; otherwise a numbered list. Confirm the detected email with Yes / Type a different one, then run `gohive install --email <address>` with that answer.

Claude Code session markers select only Claude Code. Codex session markers select only Codex. Without markers, the installer chooses detected clients. Use `--client claude|codex|all|executor` for an explicit choice.

The agent path opens no browser. A new owner receives a personal hive, a hashed bearer credential and one claim email. The credential works on MCP and capture hooks. Until claim, it can use only the owner's personal hive and capture policy. Any email provider is allowed. Accounts, credentials and private cells expire after seven days unclaimed.

For an already verified owner, bootstrap sends a single-use connection email and returns no credential. Say “Click the link in your email to connect this machine.” Run `gohive status` after the click to finish configuration.

Claude Code stores the Authorization header in its private user config. Codex uses a local header helper that reads `HIVE_AGENT_TOKEN` or `~/.hive/agent.json`, with a private static header for older clients. An unset bearer environment variable does not block startup. Executor's local proxy reads the same credential file. Capture hooks use that credential too.

## Claim and join

A claim email link is single-use and expires after 24 hours. Signing in with Google or Slack using the same verified email also claims the owner. Claim runs verified-domain joining and lets all active agents follow the owner's memberships as members. Agent credentials never grant admin access.

Pass `--join-url https://gohive.dev/j/<phrase>` when the setup prompt supplies a join link. A verified claim completes the pending human join instruction. An outside-domain person creates a join request for an admin; no membership is granted until approval. Unclaimed agents cannot create requests.

## Select and share projects

Ask once which detected projects Hive may learn from. Use a native multi-select picker with repositories and `github.com/<org>/*` options when remotes share an organisation. Do not scan home directories or transcripts. No answer means no capture.

After joining, offer “Share your learnings with <Team>?” with Yes, Choose projects and Not now. Yes creates one all-selected-projects grant covering current and future project selections. Choose projects starts with unchecked choices and cell counts. Not now creates no grant; the offer remains available on Account and Team. Originals remain personal. Every grant records the human instruction.

The agent reads `hive_agent_status` and sends the answer through `hive_share_with`. Joining alone never publishes cells.

## Existing sessions

If Hive MCP tools are absent, never install during unrelated work. Run `npx --yes gohive@latest status` once. If installed and signed in, say “Hive is set up but not loaded in this session; restart Codex (or run /mcp in Claude Code) to use it” and continue without Hive. If not installed, offer setup in one line and stop setup work.

Never announce installation or print a team invitation outside an actual install. If latest resolves to a missing version, retry once with the version status printed, then stop quietly. If npm's min-release-age blocks gohive, ask the person before overriding it and point them at the public source: https://github.com/charliedowler/hivemind.

## Human OAuth and revocation

`gohive login` connects as a person with OAuth and a detached callback listener. The browser ends on /signed-in. Account and Team let the owner revoke one agent. `gohive uninstall` revokes this machine's credential or cancels its pending connection before removing owned config. Other users, memberships and cells remain intact.
