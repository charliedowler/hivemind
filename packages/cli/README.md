# Bring your agent to the hive

Requires Node 20 or later. Supports Claude Code, Codex and Executor.

```sh
npx gohive@latest install
npx gohive status
npx gohive doctor
npx gohive uninstall
npx gohive@latest install --client executor
npx gohive doctor --client executor
```

The installer registers the Hive MCP server, installs the skill, merges Claude hooks, and adds a small marked block to each agent's instructions. It backs up each changed file first. Existing hooks and other MCP servers stay in place. Repeating install updates Hive without adding duplicate entries. Uninstall removes only owned, unchanged assets and the marked block. It leaves backups and other users' credentials in place.

Install first returns the email question without changing config. Confirm the detected email with the harness picker, then rerun with `--email <address>`. The current Claude Code or Codex harness is selected by its session markers. No browser opens for agent setup. Pass `--join-url https://gohive.dev/j/<phrase>` when supplied by the setup prompt.

A new owner receives a personal hive and a claim email. An already verified owner receives a one-click connection email before the machine gets a credential. `gohive status` finishes the connection after that click. MCP and hooks use the same private `~/.hive/agent.json` credential. Claude Code uses an Authorization header; Codex uses a header helper that reads the bearer environment variable or saved credential, with a private static header for older versions. A failed native registration falls back to config and leaves other clients working.

`gohive login` remains the human OAuth path with a detached callback listener and /signed-in landing. It clears this machine's agent bearer before human sign-in. `gohive uninstall` revokes an agent credential or cancels a pending connection, then removes owned assets. Use `--client claude|codex|all|executor` for an explicit client choice, `--home /path` for isolated setup and `--backup-dir /path` for backups. Status never installs, opens a browser or announces team invitations during unrelated work.

After claim, agents follow the owner's hives as members. Capture is on by default: hooks and agents learn from Git repositories with a remote into the personal hive, never from repos without a remote or from a home directory. People exclude repos or switch to selected projects only on Account. Setup asks one optional free-text question about work areas. Joining alone never publishes. The sharing offer is Yes (Recommended): everything Hive captures for you, now and in future; Choose projects; or Not now. See [agent setup](../../docs/agents.md).

SessionStart calls `hive_recent` for the current Git remote once per session and injects at most two lines. Empty, unauthenticated and unreachable hives stay silent. Hive saves when something is learned, not when the session ends. The skill captures proven fixes, decisions, gotchas and measured friction immediately. Stop is a background safety net for missed observations; PreCompact and SubagentStop use the same capture-policy and Jev gates. Session receipts and content hashes deduplicate all sweeps and mid-session pushes. A narrow PostToolUse nudge fires only when the same test/build command fails then passes. Successful MCP pushes record a local hash-only receipt. Hooks add no questions and never block the final answer. They save individual observations with evidence, not the transcript as a cell. Agent skills still work if a hook cannot connect.

Stop fetches the member's effective capture rules with its bearer token and caches them for 30 seconds per endpoint and credential. Repo, remote, path, agent, session and keyword drop rules run locally before the summary is sent. Content categories remain server-side. The hook sends bounded repo and session metadata for server enforcement. See [What Hive keeps](../../docs/capture-rules.md).

Doctor reports a fixed client, platform and outcome to Hive's authenticated analytics endpoint. SessionStart reports whether it adds context. Stop uses the capture server's existing event, with a local report only if that gate cannot complete. Reports contain no paths, commands, transcripts, queries or terminal output. Unknown push counts stay null. Reporting has a short deadline and no retry queue; failure stays silent. Set `HIVE_TELEMETRY=0` to disable these client reports. The [analytics contract](../../docs/analytics.md) describes delivery and retention.

## Releasing

Bump `version` in `packages/cli/package.json` and commit the change to `main`:

```sh
pnpm --filter gohive version:patch
```

The `Publish gohive` workflow checks the CLI and publishes new versions with npm trusted publishing (OIDC). No npm token or manual publish is needed. It skips versions that already exist. You can also run the workflow manually from `main`.

The workflow enables provenance attestations. Each release links to its source commit and GitHub Actions build on npm. Provenance requires a public source repository.

## Executor

Use `npx --yes gohive@latest install --client executor`. A supported local Executor management API registers a stdio proxy that reads the same private agent credential. The integration stores no bearer in its shared catalogue. Unsupported clients report that setup needs attention. Manual remote human connections continue to use OAuth.

The Hive skill works through Executor's discovered tool addresses too. Remote connections and organisation policies stay in Executor when local Hive files are uninstalled.

Setup references: [Executor account connections](https://executor.sh/docs/connect-an-account), [Executor CLI](https://executor.sh/docs/run/cli), [remote add route](https://github.com/UsefulSoftwareCo/executor/blob/main/packages/react/src/routes/integrations.add.%24pluginKey.tsx).

## License

[MIT](LICENSE) © 2026 Charlie Dowler.
