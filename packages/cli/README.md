# Bring your agent to the hive

Requires Node 20 or later and Claude Code or Codex.

```sh
npx gohive install
npx gohive doctor
npx gohive uninstall
```

The installer registers the Hive MCP server, installs the skill, merges Claude hooks, and adds a small marked block to each agent's instructions. It backs up each changed file first. Existing hooks and other MCP servers stay in place. Repeating install updates Hive without adding duplicate entries. Uninstall removes only owned, unchanged assets and the marked block. It leaves backups and credentials in place.

Sign in with `codex mcp login hive`, or open Claude and use `/mcp`. Run `npx gohive login` once to let the lightweight hooks use OAuth too. The hook login is separate from the agents because their credential stores are private. Credentials stay in `~/.hive/oauth.json` with mode 0600. Existing Hive API keys also work for hooks without a login.

Use `--yes` for a non-interactive install. It prints the sign-in steps. Use `--agent claude` or `--agent codex` to select one agent. `--home /path` changes the home for every file and child command; do not use it to share credentials between people. `--backup-dir /path` sets a backup destination.

SessionStart calls `hive_recent` for the current Git remote once per session and injects at most two lines. Empty, unauthenticated and unreachable hives stay silent. Stop keeps the existing Jev capture gate and asks for scrubbed learnings at most once per session. It never saves the transcript as a cell. Agent skills still work if a hook cannot connect.

Before the npm release, use the Git package:

```sh
npx --yes --package github:charliedowler/hivemind#feature/installer gohive install
```

The repo root exposes the same `gohive` binary for Git installs. To publish the standalone package after signing into npm as Charlie:

```sh
pnpm --filter gohive build
npm publish ./packages/cli --access public
```
