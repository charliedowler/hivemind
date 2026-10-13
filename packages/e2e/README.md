# Hive end-to-end tests

This package tests the shipped installer, installed hooks, Next HTTP routes and HTTP MCP together. It never reads a production database or connects Hive clients to production.

```sh
pnpm install --frozen-lockfile
pnpm e2e:fast
pnpm e2e:full
pnpm e2e
```

`e2e:fast` runs the deterministic PR subset without model credentials. `e2e:full` runs all deterministic scenarios. `e2e` is an alias for `e2e:real`: server tests plus behaviour checks through the real installed Claude Code and Codex CLIs. Real runs use model tokens from your existing CLI subscriptions.

Node 24, pnpm, Git, and either local PostgreSQL or Docker are required. The runner builds the checkout's installer, then tries the local test cluster at port 54329. If it is absent, it starts its own `pgvector/pgvector:pg17` Docker container on a free port. To use a different local cluster, set `HIVE_E2E_ADMIN_URL` to a loopback PostgreSQL URL with database-creation permission. Remote hosts are rejected. The runner creates a unique `hive_capture_rules_hive_digest_e2e_*` database, applies the repository migrations and drops only that database when it finishes.

The Next server uses a free loopback port and its own build directory. `PUBLIC_URL` and Better Auth point at that port. Mail and Slack HTTP requests go to local recording sinks. External model boundaries have deterministic fixtures; policy, authentication, authorisation and storage remain real. The queue substitute delivers to the real Slack callback route. Unexpected external fetches from the server fail and are recorded.

Real-agent scenarios create a scratch home for each run. Only required CLI credential files are copied into it, with mode 0600. They never copy the full configuration directory. Installer output, skills, hooks and credentials for the local Hive stay in that home. Each scenario removes its home in `finally`; signal handlers clean up active scenarios. Fingerprints of the real `.claude.json`, `.claude/settings.json` and `.codex/config.toml` must match before and after. Never copy a credential file into evidence or a fixture. A forced machine shutdown or SIGKILL cannot execute a cleanup handler; remove any reported remaining sandbox before the next run.

Real runs require macOS, installed `claude` and `codex` executables, and their existing subscription credentials. Claude credentials come from `.claude/.credentials.json` or a Claude-specific Keychain item copied into that scratch file. Codex copies `.codex/auth.json`. No provider API keys are inherited. The macOS sandbox permits writes only inside the scratch machine and blocks reads of the real home. Provider connections use a TLS proxy with a small host allowlist; Hive requests stay on loopback.

Cloud integrations need separate isolation: Claude uses strict MCP configuration, and Codex disables apps, plugins and remote plugins. A scratch HOME alone does not isolate account-linked cloud connectors. Do not remove these controls. The runner records the installed CLI versions, help output, sandbox profile, native tool calls and hook events. Claude's alternate config-directory namespace receives a copy of the installer-generated scratch MCP config; this adjustment is recorded.

Native MCP tools load at CLI startup. Fresh setup can require one recorded restart to use the newly installed server, with the same scratch HOME. The default real matrix permits bounded continuations, limits tools/turns and caps each Claude invocation at $2. Preanswers provide email, project selection and sharing choices. A separate print-mode scenario requires one unanswered email question and no guessed account. The noninteractive CLIs do not expose a dependable stdin question/reply protocol; this tests the reported question, not the interactive picker UI.

## Evidence and failures

Evidence defaults to `/tmp/hive-e2e/<scenario>/`; change it with `HIVE_E2E_EVIDENCE`. Each scenario saves HTTP traces, mail, Slack and model events, database counts and its result. The run writes `report.md`, `report.json` and real-configuration fingerprints. Evidence is local and uses private file permissions. CLI authentication files never belong in artifacts.

Product assertion failures exit 1. A blocked external or native-CLI capability exits 2 when there are no failures; it is never a pass. A deterministic policy test is not proof that an actual agent followed an instruction. Test reports distinguish those layers. Known product regressions remain failing assertions rather than expected failures.

Use `node packages/e2e/src/run.mjs --full --only=<name-fragment>` for a targeted rerun. `HIVE_E2E_BUG_REPORT` optionally writes a separate current-failures file for triage. It initially reports assertion evidence; classify the failure and add source-line suspicions before dispatching product fixes.

## Adding scenarios

The matrix is in [SCENARIOS.md](SCENARIOS.md). A scenario module exports an array of `{ name, fast, run }`. `run(ctx)` gets a real database connection, local URL, recorded HTTP and MCP clients, sinks and `artifact(name, value)`. Use `ctx.cleanup(fn)` for every resource created by a scenario. Use a unique synthetic identity for each test and invented `example.com` data. Database writes arrange fixtures or control time; assertions should exercise the public interface and verify the resulting state.

Call `ctx.output(text, surface)` for prose shown to a person. The cross-cutting guard checks vocabulary, time formatting, undo hints and extra confirmations. Raw JSON protocol timestamps and tool names are not human prose. Question scenarios also assert the exact question count and that no missing answer is guessed.

Keep external fakes narrow. A fake that implements Hive's permission decisions would hide product bugs. Fixtures that need existing pure policy functions import the original with `?hive-e2e-original`, which bypasses the model replacement plugin. Category classification uses the real redaction, cache, SDK and request construction against a deterministic local TypeSafe HTTP endpoint. Full-matrix privacy cases distinguish refusal before enrichment from the stricter requirement of refusal before any model call.

The fixture libraries are `humans.mjs` (real email-code and claim flows), `oauth.mjs` (PKCE and consent), `models/` (deterministic external results), `bin/` (fake native configuration and local installer dispatch), and `transcripts/` (Claude JSONL inputs). The drivers are `machine.mjs`, `real-agent.mjs`, and `policy.mjs`. Eligible work-domain tests use reserved `*.example.test`; example.com is intentionally treated as a public email provider by Hive.

The E2E workflow runs the fast subset for pushes and pull requests, and the full deterministic matrix nightly or on manual dispatch. It uses the same PostgreSQL image and local port as CI. It never receives subscription credentials. Real CLI evidence stays local; CI uploads only synthetic deterministic evidence.

The real npm registry, Claude app and ChatGPT connector UI are outside the hermetic matrix. The installer under test is built from this checkout, and reports record its version and source commit.

The primary matrix targets gohive 0.2.0 agent bootstrap and single-use email claims. Human OAuth is an explicit `gohive login` flow, retained from 0.1.10; its test runs the installed login script, loopback callback and PKCE exchange, verifies the former agent credential is revoked, and checks the completion URL. Retired AgentID start and callback routes must return 404 over HTTP.
