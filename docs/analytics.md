# Queryable Hive instrumentation

Hive records private, versioned PostgreSQL events at trusted server boundaries. It follows Wolf's append-only event envelope and reporting conventions. No external analytics service or client analytics library is required.

The events answer five questions:

1. Which members and teams use Hive, through which entrypoints, and on which days?
2. Do new members reach a key or OAuth grant, a first push, and a first ask?
3. Which kinds and sources bring knowledge, repeated facts, corrections, and measured friction?
4. How often do answers report gaps or classifiers refuse sensitive content, and how long do calls take?
5. Which failed calls or missing completions explain a stall?

Waitlist signups remain in `early_access`. There is no `waitlist.signup` event and no second signup ledger. Landing, waitlist, and install page views use a small first-party server beacon. The beacon sets no cookies. It cannot identify unique anonymous visitors.

## Envelope and privacy

`analytics_events` has one append-only row per `event_key`. Keys are SHA-256 digests of the event name, version, and operation identity. Version starts at 1. `occurred_at` and `recorded_at` are `timestamptz`; daily reports use UTC. The first accepted insert wins. Replays never update that row. Database triggers reject update, delete, and truncate.

The envelope has `team_id`, `member_id`, `api_key_id`, `session_kind`, `request_id`, `learning_id`, `entrypoint`, `environment`, `is_test`, `test_basis`, `outcome`, `reason_code`, `latency_ms`, and `properties`. Unknown values are SQL null. Every allowlisted property has JSON null when unavailable. Event keys do not contain the identity or input in clear text. An operation with no stable external identity gets a server UUID. Separate pushes remain separate observations, including merged pushes.

Team and member IDs come from an authenticated `HiveContext`. MCP key IDs come from the accepted database key row. Session kinds are `api_key`, `web_session`, `oauth`, `anonymous`, and `system`. No session token is stored. Join members by `(team_id, member_id)`. `api_key_id` identifies the credential in use; `properties.keyId` identifies a created or revoked key. `properties.targetMemberId` identifies a removed member. `properties.earlyAccessId` links a verified signup to an existing waitlist row, without an email. IDs are controlled private metadata, not anonymous identities.

Each MCP tool has a fresh request UUID. Web routes and nested service calls share their scoped request UUID. Classifier and model calls have separate `callId` values. Operations have separate `operationId` values. These distinguish parallel calls, internal search during an ask, and missing completions. Background tree publication retains a known team and member or a system origin.

Properties admit fixed enums, counts, booleans, bounded probabilities, known internal IDs, and fixed model names. Unknown property names are stripped. Known fields reject invalid values. Push verdicts include worth-sharing and sensitivity probabilities, kind probabilities, topic confidence, and severity. The writer never stores titles, bodies, queries, questions, answers, emails, names, API keys, session tokens, repository paths, Slack text, transcripts, prompts, URLs, headers, or exception messages. Reason codes are fixed server codes. Detailed existing learning evidence and ask logs keep their existing access controls.

The ledger intentionally has no cascading foreign keys. Removing a member or operational row cannot delete history. Direct database access stays private. A report role reads the ledger without operational write privileges.

## Event semantics

| Event | Trusted boundary and safe metadata |
| --- | --- |
| `access.changed` | Successful account, session, invite, key, or membership write. Outcomes: `signup`, `login`, `login_failed`, `logout`, `email_verification_sent`, `email_verified`, `invite_created`, `invite_rotated`, `invite_accepted`, `domain_join`, `key_created`, `key_revoked`, `member_removed`, `role_changed`, `mcp_oauth_authorized`. Actor kind and known role are metadata. Failed key login is anonymous and uses `invalid_credentials`. |
| `learning.pushed` | Accepted push after commit, including a merged observation. Records kind, source, merge state, classifier probabilities, sensitivity refusal, and optional measured friction minutes. A sensitive refusal emits `refused` before learning or embedding writes. |
| `learning.superseded` | An accepted replacement commits. Links the older cell to its newer cell. Candidate proposals do not count. |
| `learning.lifecycle_changed` | A committed lifecycle transition from a merge, vote, edit, moderation, or accepted replacement. Stores old and new lifecycle and a fixed reason. |
| `learning.feedback` | A member's vote persists. Records `up`, `down`, or `outdated`; no vote note. |
| `learning.viewed` | The browser mounts a cell detail and a session-authenticated beacon confirms that the cell belongs to the team. Citation title lookups and server prefetches do not count. |
| `search.performed` | Search returns. Records result count, score band, latency, and vector, text, prefix, recency, vote, and repo-boost signals. No query or repo is stored. |
| `ask.performed` | The answer log persists. Records retrieved and cited counts, evidence gate and probability, configured synthesis model when used, latency, and gap flag. Friction answers use `friction_summary`. No question or answer is stored. |
| `recent.performed` | Recent cells return. Records count and optional kind. Includes dashboard polling; this is observed use, not proof of a deliberate visit. |
| `classifier.started`, `classifier.completed` | Each push, hook, ask, relation, or rerank provider call starts and ends. Records purpose, fixed model, latency, outcome, and call ID. Unconfigured push/capture classifiers record completion with `not_configured` and no invented start. Quiet and empty pre-gates make no provider call. |
| `model.started`, `model.completed` | Each embedding, synthesis, or fallback tagger SDK call starts and ends. Records requested model, allowlisted returned model, purpose, latency, and available token usage. Unknown returned models stay null. Provider errors and refused or invalid output remain visible. |
| `operation.started`, `operation.finished` | A push, search, ask, recent, feedback, tree browse/read, or snapshot service invocation starts and ends. This exposes killed invocations and failures outside model calls. |
| `hook.fired` | The authenticated Stop capture gate completes, or a hook client reports its fixed outcome. Records session start or stop, gate decision, probability when known, and pushed count when reported. The capture server cannot observe later pushes, so its count is null. |
| `install.step` | An authenticated installer reports a fixed step or doctor result. Records agent and platform enums, not paths, commands, terminal output, or errors. Client reports are observations from an authenticated client, not server proof that installation succeeds. |
| `tree.rebuilt` | A complete knowledge manifest publishes at a database revision. Records revision and file count; one event per team revision. Cached reads do not count as rebuilds. |
| `tree.read` | An authorized browse or file read returns verified content. Records revision, file count, and bytes when known; no file path or content. |
| `snapshot.exported` | The private archive and expiring snapshot record persist. Records revision, files, and bytes. No download token or object URL. |
| `slack.event_received` | Reserved for the Slack round: record after signature verification, identity resolution, and operational deduplication. Record a fixed Slack event kind, not text. |
| `slack.reply_decided` | Reserved for the Slack round: record the actual `reply` or `silent` gate decision and relevance probability when available. |
| `page.viewed` | A same-origin browser beacon for `landing`, `waitlist`, or authenticated `install`. No arbitrary route, referrer, browser identity, or extra cookies. Counts are reported loads, not unique visitors. |

Entrypoints are `mcp`, `web`, `slack`, `hook`, `installer`, `scheduled`, and `unknown`. Sources are `claude-code`, `codex`, `slack`, `web`, `hook`, and `unknown`. Existing manual pushes through MCP have unknown agent source. A web manual push has web source. A hook or Slack origin supplies its source. Existing Stop nudges cause later MCP pushes with the agent's source; they do not prove hook attribution.

## Environment and synthetic traffic

Environment is `test` under unit tests, otherwise the known Vercel production or preview environment, development, or unknown. Deployment URLs are not stored.

`is_test` is tri-state. Unit tests set true with basis `unit_test`. Explicit fixtures can use true with basis `simulation`. Operators can set `HIVE_ANALYTICS_TRAFFIC=real` or `synthetic` for a deployment with a known traffic policy; the basis is `deployment`. Leave it unset when real and manual test requests mix. Unknown traffic stays null with basis `unclassified`. A deployment classification is an operator label, not proof of intent.

Reports group environments and traffic classes separately. Do not label all null rows real. Fixture values labelled real exist only in isolated local schemas to test that separation.

## SQL examples and admin page

Run from `apps/web` with a private read-only ledger connection:

```sh
psql "$HIVE_REPORTING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f analytics/usage.sql
psql "$HIVE_REPORTING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f analytics/funnel.sql
psql "$HIVE_REPORTING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f analytics/knowledge.sql
psql "$HIVE_REPORTING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f analytics/quality.sql
psql "$HIVE_REPORTING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f analytics/stalls.sql
```

All five reports cover the last 30 days. `usage.sql` counts scoped active members and teams by day and entrypoint. It excludes a search nested in a completed ask from interaction counts. It still records that search for latency analysis. Recent polling can make a member active without a deliberate action.

`funnel.sql` counts signups with a known existing waitlist row and follows each member through signup, key or OAuth, first accepted push, and first ask in time order, within the same environment and traffic class. A first ask can return a gap; it does not prove a useful answer. Only signups recorded in the window form this cohort. Older members do not enter this acquisition funnel.

On verified email signup, the server matches the existing waitlist email privately after commit with a 500 ms deadline and stores only that row ID on `access.changed` with outcome `signup`. This measures known waitlist follow-through for a team. Older signup events and failed lookups have no invented link. It does not expose total waitlist size through the ledger-only role. `analytics/waitlist.sql` reads aggregate unique emails from the existing table through a separate controlled operational connection. The ledger-only reporting role cannot run that extra query. The operator can join `properties.earlyAccessId` to that table for an acquisition cohort. A raw ratio of unmatched windows is not a conversion rate. Team admins cannot read global waitlist counts.

`knowledge.sql` counts observations, merges, accepted replacements, measured friction minutes, and unknown-cost reports. It does not count unknown costs as zero. A repeated friction push keeps its own measured cost. Supersessions without kind/source metadata occupy a separate null group.

`quality.sql` reports ask gap rates, sensitive push refusals, observed failures, and p50/p95 latency per event and entrypoint. Available model tokens live in `model.completed` properties. Sum them only there. Missing provider usage is null, not zero. SDK retries are included in the logical call latency; these events do not enumerate transport attempts or price model usage.

`stalls.sql` reports failed model/classifier/request outcomes and starts older than two minutes with no matching completion. An absent completion can mean analytics delivery failed or a process died. It does not prove a business failure. Multiple stalled calls can belong to one request.

`/app/admin/analytics` loads the same five files inside a read-only transaction after `requireAdmin`. A transaction-local setting scopes every report to the authenticated team. No team ID comes from browser input. The page uses Hive cards, sprites, small tables, and square pixel bars. Bars total all traffic; table rows retain environment and traffic labels. Load or Refresh tables runs the reports again. There is no chart library or continuous polling on this page.

The migration creates a `hive_reporting` NOLOGIN role with schema usage and SELECT on `analytics_events` only. Provision a private login with that role through the database's credential controls. Set `HIVE_REPORTING_DATABASE_URL` for reporting tools. Do not use the application write connection for Lightdash. A Lightdash project is not created by this change. The report role grants no access to the separate waitlist table.

## Delivery, rollout, and rollback

Every event write is awaited. Each has a 500 ms abort deadline. Correlated request writes share a four-second budget. Analytics uses its own small connection pool and a 450 ms database statement timeout. Timed-out queries receive best-effort cancellation. There is no unbounded application retry queue or detached insert promise.

Failures are caught and emit a structured diagnostic at most once per minute per process. The diagnostic has a fixed event name and a failure count, with no input or exception text. Provider and user actions are not retried by analytics. Lifecycle events buffer inside the operational transaction and flush only after commit. Analytics failures do not roll back business data. Process termination can still leave gaps; delivery is best effort.

The merge step applies production migrations before deploying the application. This branch does not apply production migrations. From the reviewed merged repository, with the production DATABASE_URL supplied through the existing secret mechanism, run:

```sh
pnpm --filter web db:migrate
```

This uses the existing file-order runner and records `0013_analytics_events.sql` in `_migrations`. Numbers 0011 and 0012 belong to the Better Auth and OAuth round. The new migration is additive, transactional, and repeatable. It uses a three-second lock timeout and a 30-second statement timeout. Applying it requires permission to create the table, function, trigger, indexes, and reporting role. A lock or permission error rolls back and must be resolved before deployment.

For a controlled application rollback, deploy the previous code and retain the event table. The new table has no operational foreign keys or required columns in existing tables. `apps/web/drizzle/rollback/0013_analytics_events.sql` removes an empty ledger and its migration marker. It locks the table and refuses to drop recorded history. Archive and review retention before any separate destructive removal. The shared NOLOGIN reporting role remains available with no grant on the removed table.

## Wiring for later rounds

The module exports `withOrigin`, `originFor`, `recordEvent`, `accessEvent`, `bindApiKey`, and `bindRole`. Use an origin established by verified identity. Do not take team, member, key, environment, or traffic classification from an unauthenticated request body.

For Slack, call `withOrigin(originFor(ctx, "slack"), action)` after verification and deduplication. Record `slack.event_received` with outcome `received`, and hash a key built from the validated team and source event ID. Record `slack.reply_decided` with the actual gate and a fixed reason when one applies. The shared push/search/ask services emit their own events within this context. Persist the safe origin if a queued continuation outlives the request. Never persist Slack text or tokens in generic events.

For Better Auth, wire signup, login failure/success, logout, verification, enrollment, role changes, and MCP consent at their successful trusted boundaries. Legacy access events are already wired here. The new flow must bind the member role and key ID when known. A verified signup can use `earlyAccessIdForEmail` to attach the existing waitlist row ID without logging the email. OAuth MCP calls need `originFor(ctx, "mcp", "oauth")`; consent emits `mcp_oauth_authorized` only after a successful grant. Do not infer consent from a redirect or code exchange failure. Team enrollment can occur after signup; keep unknown team/member fields null until identity is established.

For the installer, POST to `/api/analytics/install` with a member API key and this fixed body:

```json
{"attemptId":"00000000-0000-4000-8000-000000000001","step":"doctor","outcome":"completed","agent":"codex","platform":"darwin"}
```

Steps are `started`, `mcp_configured`, `instructions_written`, `hook_configured`, `completed`, and `doctor`. Outcomes are `completed`, `failed`, and `skipped`. The server validates values, authenticates the member, assigns the envelope, and deduplicates `(team, member, attempt, step)`. Each actual retry needs a new attempt UUID; a transport replay reuses it. Anonymous pre-key installation has no reporting endpoint in this round. A 204 means the report is accepted for best-effort delivery, not a guarantee that the row persists.

`/api/analytics/hook` accepts an authenticated report with `attemptId`, `hookKind` (`session_start` or `stop`), `gateDecision` (`capture` or `skip`), and nullable `pushedCount`. The existing Stop capture endpoint already records `hook.fired`. Do not send a second fire event for that same gate. Quiet sessions currently make no network request. The installer round can report a session-start hook, local-only skip outcomes, or measured capture completion separately when it has evidence. No count is inferred from an agent nudge.

## Coverage limits and local verification

Data starts when this code deploys. There is no historical backfill. Existing mutable rows cannot reconstruct all past actions. The beacon depends on browser delivery and cannot distinguish a deliberate view from every restored browser state. Dashboard polling is visible use, not engagement proof. All property and model allowlists need a deliberate update when adding a new model or event outcome.

Run the fixture suite on the dedicated local endpoint. It creates and removes its own schema and does not change operational tables:

```sh
HIVE_ANALYTICS_TEST_DATABASE_URL=postgres://hivemind:hivemind@127.0.0.1:54329/hivemind pnpm --filter web test src/server/analytics
pnpm -r typecheck
pnpm -r test
pnpm --filter web build
```

The fixture suite checks replay identity, null fields, privacy, independent concurrent origins, failure deadlines, post-commit events, append-only triggers, role privileges, admin/team guards, rollback refusal, and all five SQL reports with known counts. The service integration test records real push, merge, feedback, correction, search, ask, recent, and refusal boundaries through an injected event writer. The ordinary suite makes no provider calls. Database tests need DATABASE_URL; the live TypeSafe smoke test remains opt-in.

For a local demo, `HIVE_ANALYTICS_TEST_DATABASE_URL=... pnpm --filter web exec tsx scripts/analytics-fixture.ts` creates a fresh isolated schema, applies migrations there, seeds events and synthetic sessions, and writes a new ignored `.env.local`. It refuses to overwrite an existing env file and accepts only the local endpoint. Never deploy the fixture sessions. The [verification report](analytics-report.md) contains the seeded SQL outputs and the reviewed 1280-pixel Playwright screenshot.
