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

Status prints the organisation join link and invitation prompt. Repeat it to the person only when asked about invitations. Never announce installation outside an actual install. If latest resolves to a missing version, retry once with the version status printed, then stop quietly. If npm's min-release-age blocks gohive, ask the person before overriding it and point them at the public source: https://github.com/charliedowler/hivemind.

## Updates

Hive checks for updates once a day. Claude Code checks at SessionStart. Codex and Executor run `npx --yes gohive@latest status` on the first Hive use of a session. The public `/api/cli/version` endpoint and MCP initialize metadata advertise `{ latest, minimum }` from `apps/web/src/lib/cli-version.json`. Bump the CLI package and release JSON together on release.

The check times out after two seconds and fails quietly offline. The timestamp, result and installed version stay in `~/.hive`. When behind, a detached process runs `npx --yes gohive@<latest> install --update`. It backs up existing files, refreshes owned scripts, skill text, instructions and hooks, and keeps the installed clients, credentials and selected projects. It asks no questions and opens no browser. Local changes to owned skill files stop the update safely.

Ordinary updates are silent. Below minimum, the agent says `Hive updated to <version>` after success, or “Hive needs an update: run `npx gohive@latest install`” after failure. Set `HIVE_NO_AUTO_UPDATE=1` or create `~/.hive/no-auto-update` to opt out. Run `npx --yes gohive@latest install --update` for an immediate file refresh; explicit updates still work when automatic updates are disabled.

OAuth-era installs keep their OAuth connection without sign-in. A one-time notice offers `npx gohive@latest install` to switch to the credential flow. Old frozen hooks need one current `gohive status` call, prompted by MCP instructions, to receive the updater; the old hook alone cannot discover new executable code.

## Isolated Codex runs

The installer writes a native HTTP MCP server in `~/.codex/config.toml` with the local credential helper. Hive does not need an account-linked cloud app or plugin. A scratch HOME or CODEX_HOME alone does not isolate cloud connectors. For isolated runs use `codex --disable apps --disable plugins --disable remote_plugin --disable enable_mcp_apps --disable skill_mcp_dependency_install` and an explicit scratch CODEX_HOME, as the E2E harness does. Check the available tools before the run; use the native `hive` MCP tools for the scratch server.

Claude Code's Stop safety net runs synchronously with an eight-second outer bound and fails quietly. PreCompact and SubagentStop remain background hooks.

## Human OAuth and revocation

`gohive login` connects as a person with OAuth and a detached callback listener. The browser ends on /signed-in. Account and Team let the owner revoke one agent. `gohive uninstall` revokes this machine's credential or cancels its pending connection before removing owned config. Other users, memberships and cells remain intact.
