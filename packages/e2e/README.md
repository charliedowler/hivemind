# Hive end-to-end tests

This package tests the shipped installer, installed hooks, Next HTTP routes and HTTP MCP together. It never reads a production database or connects Hive clients to production.

```sh
pnpm install --frozen-lockfile
pnpm e2e:fast
pnpm e2e:full
pnpm e2e
```

`e2e:fast` runs the deterministic PR subset without model credentials. `e2e:full` runs all deterministic scenarios. `e2e` is an alias for `e2e:real`: server tests plus behaviour checks through the real installed Claude Code and Codex CLIs. Real runs use model tokens from your existing CLI subscriptions.

Node 24, pnpm and local PostgreSQL are required. The runner tries the local test cluster at port 54329. If it is absent, it starts its own `pgvector/pgvector:pg17` Docker container on a free port. To use a different local cluster, set `HIVE_E2E_ADMIN_URL` to a loopback PostgreSQL URL with database-creation permission. Remote hosts are rejected. The runner creates a unique `hive_capture_rules_hive_digest_e2e_*` database, applies the repository migrations and drops only that database when it finishes.

The Next server uses a free loopback port and its own build directory. `PUBLIC_URL` and Better Auth point at that port. Mail and Slack HTTP requests go to local recording sinks. External model boundaries have deterministic fixtures; policy, authentication, authorisation and storage remain real. The queue substitute delivers to the real Slack callback route. Unexpected external fetches from the server fail and are recorded.

Real-agent scenarios create a scratch home for each run. Only required CLI credential files are copied into it, with mode 0600. They never copy the full configuration directory. Installer output, skills, hooks and credentials for the local Hive stay in that home. Each scenario removes its home in `finally`; signal handlers clean up active scenarios. Fingerprints of the real `.claude.json`, `.claude/settings.json` and `.codex/config.toml` must match before and after. Never copy a credential file into evidence or a fixture. A forced machine shutdown or SIGKILL cannot execute a cleanup handler; remove any reported remaining sandbox before the next run.

## Evidence and failures

Evidence defaults to `/tmp/hive-e2e/<scenario>/`; change it with `HIVE_E2E_EVIDENCE`. Each scenario saves HTTP traces, mail, Slack and model events, database counts and its result. The run writes `report.md`, `report.json` and real-configuration fingerprints. Evidence is local and uses private file permissions. CLI authentication files never belong in artifacts.

Product assertion failures exit nonzero. A blocked external or native-CLI capability is reported separately and is never a pass. A deterministic policy test is not proof that an actual agent followed an instruction. Test reports distinguish those layers.

Use `node packages/e2e/src/run.mjs --full --only=<name-fragment>` for a targeted rerun. `HIVE_E2E_BUG_REPORT` optionally writes a separate current-failures file for triage. It initially reports assertion evidence; classify the failure and add source-line suspicions before dispatching product fixes.

## Adding scenarios

The matrix is in [SCENARIOS.md](SCENARIOS.md). A scenario module exports an array of `{ name, fast, run }`. `run(ctx)` gets a real database connection, local URL, recorded HTTP and MCP clients, sinks and `artifact(name, value)`. Use `ctx.cleanup(fn)` for every resource created by a scenario. Use a unique synthetic identity for each test and invented `example.com` data. Database writes arrange fixtures or control time; assertions should exercise the public interface and verify the resulting state.

Call `ctx.output(text, surface)` for prose shown to a person. The cross-cutting guard checks vocabulary, time formatting, undo hints and extra confirmations. Raw JSON protocol timestamps and tool names are not human prose. Question scenarios also assert the exact question count and that no missing answer is guessed.

Keep external fakes narrow. A fake that implements Hive's permission decisions would hide product bugs. Fixtures that need existing pure policy functions import the original with `?hive-e2e-original`, which bypasses the model replacement plugin.

The real npm registry, Claude app and ChatGPT connector UI are outside the hermetic matrix. The installer under test is built from this checkout, and reports record its version and source commit.
