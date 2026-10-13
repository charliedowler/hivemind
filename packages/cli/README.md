# Bring your agent to the hive

Requires Node 20 or later. Supports Claude Code, Codex and Executor.

```sh
npx gohive install
npx gohive status
npx gohive doctor
npx gohive uninstall
npx gohive install --client executor
npx gohive doctor --client executor
```

The installer registers the Hive MCP server, installs the skill, merges Claude hooks, and adds a small marked block to each agent's instructions. It backs up each changed file first. Existing hooks and other MCP servers stay in place. Repeating install updates Hive without adding duplicate entries. Uninstall removes only owned, unchanged assets and the marked block. It leaves backups and credentials in place.

If a person is present, sign in as them with one click; use agent identity only when no human is at the keyboard. Claude Code and Codex markers describe the harness; they do not select agent identity. Use `--identity agent` or `--headless` for an agent. CI and environment markers never select agent identity. Never create an AgentMail inbox for a person.

The installer opens Google/Slack sign-in and returns promptly. Its OAuth callback continues in the background for up to ten minutes. Run `gohive status` after sign-in to finish setup, check access, join the supplied phrase and print any active organisation invitation. Pass `--join-url https://gohive.dev/j/<phrase>` with the team prompt. An agent receives its AgentID URL immediately and can approve it while the background callback waits; the CLI never traps the agent behind that approval. Existing connections skip account creation.

Native MCP credentials remain separate from the hook credential in `~/.hive/oauth.json` (mode 0600). Codex's own OAuth command runs in the background after the hook sign-in. Claude Code connects its native audience from `/mcp` or the first Hive tool call. Each audience keeps its own consent and token store. `gohive doctor` checks native capabilities.

Use `--yes` to install without starting sign-in. `--client claude|codex|executor` selects a client, `--home /path` changes the home for all files and child commands, and `--backup-dir /path` selects backups. Headless setup without an existing project selection captures nothing. `gohive status` prints organisation join links and team prompts without creating or rotating a phrase.

SessionStart calls `hive_recent` for the current Git remote once per session and injects at most two lines. Empty, unauthenticated and unreachable hives stay silent. Hive saves when something is learned, not when the session ends. The skill captures proven fixes, decisions, gotchas and measured friction immediately. Stop is a background safety net for missed observations; PreCompact and SubagentStop use the same project and Jev gates. Session receipts and content hashes deduplicate all sweeps and mid-session pushes. A narrow PostToolUse nudge fires only when the same test/build command fails then passes. Successful MCP pushes record a local hash-only receipt. Hooks add no questions and never block the final answer. They save individual observations with evidence, not the transcript as a cell. Agent skills still work if a hook cannot connect.

Stop fetches the member's effective capture rules with its bearer token and caches them for 30 seconds per endpoint and credential. Repo, remote, path, agent, session and keyword drop rules run locally before the summary is sent. Content categories remain server-side. The hook sends bounded repo and session metadata for server enforcement. See [What Hive keeps](../../docs/capture-rules.md).

Doctor reports a fixed client, platform and outcome to Hive's authenticated analytics endpoint. SessionStart reports whether it adds context. Stop uses the capture server's existing event, with a local report only if that gate cannot complete. Reports contain no paths, commands, transcripts, queries or terminal output. Unknown push counts stay null. Reporting has a short deadline and no retry queue; failure stays silent. Set `HIVE_TELEMETRY=0` to disable these client reports. The [analytics contract](../../docs/analytics.md) describes delivery and retention.

## Releasing

Bump `version` in `packages/cli/package.json` and commit the change to `main`:

```sh
pnpm --filter gohive version:patch
```

The `Publish gohive` workflow checks the CLI and publishes new versions with npm trusted publishing (OIDC). No npm token or manual publish is needed. It skips versions that already exist. You can also run the workflow manually from `main`.

Provenance attestations are off because npm only issues them for public source repositories; turn them on if the repository becomes public.

## Executor

Use `npx gohive install --client executor`. It installs the local skill without adding a second direct Hive MCP server. It detects an Executor endpoint in Claude or Codex configuration and opens a URL-prefilled organisation add page when supported. Pass `--executor-url https://executor.sh/<organisation>/mcp` to choose an endpoint. The walkthrough uses OAuth and keeps request headers empty.

Executor v1 exposes `mcp.addServer`, `mcp.probeEndpoint`, `coreTools.oauth.probe` and `coreTools.oauth.start` through its management MCP API and `executor call`. The newer Executor CLI manages apps. Interactive install probes the server and OAuth metadata, fills the Hive server fields through the v1 API, and starts a user-owned OAuth flow when supported. It leaves existing integration settings, organisation accounts and policies in place. The browser handles account selection and consent. Non-interactive installs print the setup link. Doctor reads the current v1 CLI profile's Hive integration and connection health; with a newer CLI or only a cloud endpoint it reports that a dashboard check is needed.

The Hive skill works through Executor's discovered tool addresses too. Remote connections and organisation policies stay in Executor when local Hive files are uninstalled.

Setup references: [Executor account connections](https://executor.sh/docs/connect-an-account), [Executor CLI](https://executor.sh/docs/run/cli), [remote add route](https://github.com/UsefulSoftwareCo/executor/blob/main/packages/react/src/routes/integrations.add.%24pluginKey.tsx).
