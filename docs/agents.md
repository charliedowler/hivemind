# Connect a coding agent to Hive

Hive issues the agent credential. People still use Google, Slack or email with OAuth.

## Install

Run `npx --yes gohive@latest install` in the repository. When Executor is absent or declined, the first run reads Git email and returns a structured question without changing config. Ask with the harness's question/picker tool when one exists; otherwise a numbered list. Confirm the detected email with Yes / Type a different one, then run `gohive install --email <address>` with that answer.

Claude Code session markers select only Claude Code. Codex session markers select only Codex. Without markers, the installer chooses detected clients. Use `--client claude|codex|all|executor` for an explicit choice.

The agent path opens no browser. A new owner receives a personal hive, a hashed bearer credential and one claim email. The credential works on MCP and capture hooks. Until claim, it can use only the owner's personal hive and capture policy. Any email provider is allowed. Accounts, credentials and private cells expire after seven days unclaimed.

For an already verified owner, bootstrap sends a single-use connection email and returns no credential. Say “Click the link in your email to connect this machine.” Run `gohive status` after the click to finish configuration.

Claude Code stores the Authorization header in its private user config. Codex uses a local header helper that reads `HIVE_AGENT_TOKEN` or `~/.hive/agent.json`, with a private static header for older clients. An unset bearer environment variable does not block startup. Capture hooks use that credential too.

## Executor

Executor hosts apps and remote MCP servers. A Hive connection shares memory with every app and agent that uses that Executor. Agents discover and call tools through `skills`, `search`, `describe`, `call` and `execute`.

Install and status detect the CLI on PATH, `~/.executor`, an XDG config directory, or `HIVE_EXECUTOR_TOOLS=1`. Pass that variable when Executor tools are visible. Install returns `offer_executor` once: “You use Executor. Hive can be a connection there too, so every app and agent you run through it shares the same memory. Set it up?” Use the harness picker with Yes / Not now. Yes runs `npx gohive install --client executor`; Not now runs `npx gohive install --skip-executor` and saves the choice in `~/.hive/executor.json`.

Executor setup uses name Hive, slug hive, the remote URL `https://gohive.dev/api/mcp` (or `HIVE_URL` plus `/api/mcp`), and human OAuth. It asks no email, namespace or URL questions and creates no bootstrap credential or claim email. The CLI checks the saved connection inventory and remote endpoints first. A healthy match, including a different slug, returns “Hive is already connected in Executor”. A failed inventory check stops registration. Existing apps and accounts remain in place.

Executor v1 exposes Quick Add through `executor call executor mcp addServer`; it has no `executor apps` command. The installer uses that interface and Executor's OAuth discovery/client/start tools. It reuses a matching app and an authorization-code client. Run `gohive install --client executor --dry-run` to check the guard and print the registration arguments without registering or starting OAuth.

Without a usable CLI, the installer prints three steps:

1. In Executor, choose Add app → Quick Add.
2. Choose remote MCP server; name it Hive and use `https://gohive.dev/api/mcp`.
3. Choose OAuth, then open its connection link and sign in as yourself.

With session tools, the agent follows the three-line tools path on `/agent`: search/describe/call the inventory and check endpoints first; register or reuse the remote MCP integration; start OAuth and relay the connection link. Credentials move only through Executor's secure connection links. The person clicks once and signs in as themselves with person-wide consent, then runs `npx gohive status`.

Executor supplies Hive's server instructions and tools after connection. The installer writes `~/.hive/EXECUTOR.md` and the local skill without hooks or a direct harness MCP server. Capture runs on-signal from repositories the owner's policy allows. Ask the work-areas question once if it has not been answered. Status prints Executor detection and its saved connection health; when only session tools are available, check the connection inventory through those tools.

## Claim and join

A claim email link is single-use and expires after 24 hours. Signing in with Google or Slack using the same verified email also claims the owner. Claim runs verified-domain joining and lets all active agents follow the owner's memberships as members. Agent credentials never grant admin access.

Pass `--join-url https://gohive.dev/j/<phrase>` when the setup prompt supplies a join link. A verified claim completes the pending human join instruction. An outside-domain person creates a join request for an admin; no membership is granted until approval. Unclaimed agents cannot create requests.

## What Hive learns from, and sharing

Hive captures by default. Learnings from Git repositories with a remote go to the person's personal hive; repositories without a remote and home directories capture nothing. The person can exclude repositories, or switch to "only the projects I list", on Account or by telling their agent. Setup asks one optional question: "What kinds of things do you work on that Hive can learn from? Type a few areas, or skip." The answer is saved as `workAreas`. It tags captures, nudges the capture gate towards findings in those areas and words the share question; it never limits capture.

After joining, offer the share question from `hive_agent_status` (for example “Share your learnings about frontend React and dbt models with <Team>?”) with Yes (Recommended), Choose projects and Not now, in that order. Yes creates one grant covering everything Hive captures for the person, now and in future. Choose projects starts with unchecked choices and cell counts. Not now creates no grant; the offer remains available on Account and Team. Originals remain personal. Every grant records the human instruction.

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
