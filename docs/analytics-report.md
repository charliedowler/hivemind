# Hive analytics implementation report

## Round C, 13 October 2026

The analytics, Decisions, tree, digest-settings and separate waitlist pages are removed. Team retains export; Slack retains scheduling. The analytics ledger and private SQL reports remain. All browser page, cell and error beacons and their endpoints are removed. The cookie banner and privacy preferences remain with only necessary cookies. The earlier verification below is historical and does not describe the current page set. Screenshots of removed pages are deleted.


## Better Auth integration, 13 October 2026

The landing merge preserves main at `dec46f6` and adds Better Auth access events. Signup is the committed verified enrollment milestone. Enrollment records invite creation, invite acceptance, domain joins and creator role promotion. Sessions record login and explicit logout; email verification records successful delivery and verification. Failed email login remains anonymous. Consent records a successful authorization-code grant, with no event for denied or invalid consent. Existing key, invite rotation and member removal events remain in place.

MCP carries the verified key ID, role and OAuth session kind into each tool. Capture and both analytics client beacons use the shared OAuth bearer verifier, including its audience, scope and active-membership checks and legacy key fallback. The installer agent enum includes `executor`. Access replay keys include the outcome so key creation does not suppress revocation.

Merged verification: recursive typecheck passes; 59 core and 179 web tests pass, with only the opt-in live classifier test skipped; the production web build passes. The suite uses a fresh isolated local schema and includes PostgreSQL ledger/report checks. Better Auth tests cover envelope privacy, pre-enrollment null identity, login failure, logout, denied/invalid/accepted consent, OAuth and API-key install/hook reports, replay identity and removed-member rejection. React Doctor reports no errors or React diagnostics; four existing sequential-await warnings remain in scripts and the ordered push transaction.

Production migration and deployment are performed by the landing task after these checks. The original branch-only report below describes its earlier verification.

## Original branch verification

Verified on 13 October 2026. Branch: `feature/analytics`. Base: `31f347a` from `origin/main`. The implementation mirrors Wolf's ledger conventions. No production migration, deployment, merge, live provider call, Slack message, or Lightdash project is made in this round.

## Changes

The new `apps/web/src/server/analytics/` module provides a versioned envelope, SHA-256 replay keys, typed allowlists, request context, bounded delivery, post-commit lifecycle events, authenticated beacons, and five scoped reports. Trusted boundaries cover legacy access, learning writes and reads, retrieval, classifiers, models, Stop capture, and the knowledge tree.

The [event table](analytics.md#event-semantics) defines all current and reserved events. The [integration contracts](analytics.md#wiring-for-later-rounds) cover Slack, installer, hook, and Better Auth work. The [privacy contract](analytics.md#envelope-and-privacy) excludes all titles, bodies, queries, questions, names, emails, tokens, paths, and Slack text.

## Migration and exact merge-time command

Apply `apps/web/drizzle/0013_analytics_events.sql` at the merge step, before deployment, from the reviewed merged checkout. Supply the production DATABASE_URL through the existing secret mechanism:

```sh
pnpm --filter web db:migrate
```

The existing runner tracks the migration in `_migrations`. The migration adds the ledger, four indexes, update/delete/truncate rejection, and a NOLOGIN `hive_reporting` role with SELECT on the ledger only. It uses short lock and statement timeouts and can run twice. Migration numbers 0011 and 0012 are reserved for the Better Auth and MCP OAuth branch.

Rollback: `apps/web/drizzle/rollback/0013_analytics_events.sql`. Deploying the previous app retains history. The schema rollback refuses a nonempty ledger. Production migration is not applied by this branch.

`HIVE_REPORTING_DATABASE_URL` is documented for a private reporting login with the reporting role. It is not used to create a Lightdash project. Waitlist totals stay in `early_access`, with a separate optional aggregate query through an operational read connection. Verified signup records only the matching existing waitlist row ID. Total waitlist size stays outside the ledger-only role. Older events and failed bounded lookups have no invented match.

## Verification

- `pnpm -r typecheck`: passes.
- `pnpm -r test` with the isolated schema DATABASE_URL and local analytics fixture opt-in: 59 core tests and 163 web tests pass. Only the live TypeSafe smoke test skips.
- `pnpm --filter web build`: passes. One combined build/test run hits the existing 10-second email-fixture setup limit; the sequential suite passes. The admin route's production file trace includes the five SQL files.
- All five SQL files execute in the local Postgres at `postgres://hivemind:hivemind@127.0.0.1:54329/hivemind`. The tests create and remove a unique schema. The reviewed demo uses a separate schema, with no changes to existing operational tables.
- PostgreSQL tests verify known report counts, replay preservation, migration replay with rows, update/delete/truncate rejection, reporting privileges, admin/team isolation, and rollback refusal with history.
- Boundary tests exercise accepted and merged pushes, feedback, committed correction and lifecycle events, search, ask, recent, and sensitive refusal. Every event keeps the trusted team/member/key and request scope. Private content stays out.
- A verified email signup test proves that the existing waitlist row ID enters the event while its email and code do not.
- Beacon tests cover allowed pages, same-origin enforcement, session and cell authorization, authenticated installer identity, replay keys, and rejected steps.
- React Doctor reports no errors or new diagnostics. Seven existing sequential-await warnings remain in the seed/rebuild scripts, the push transaction, and knowledge publication. They concern ordered or bounded work and are not introduced by this diff.
- The browser renders all five reports. At widths 1280 and 390, document width equals viewport width. A non-admin session receives the admin-required view with zero tables. The Refresh tables control requests a new server render.

## Screenshot

`docs/screenshots/analytics-admin-1280.png` is a full-page Playwright capture from the local server at a 1280 × 1000 viewport. It contains only synthetic fixture data. The image is opened and visually reviewed. The stalls table keeps outcome and count visible; sprites do not rotate or fade.


## Seeded SQL outputs

The commands below use the demo schema and `hive.reporting_team=team_aaaaaaaaaaaa`. All output rows are fixtures. Labels named real and unclassified exist to prove that the reports keep those classes distinct. They do not represent real product traffic. The test's known core sample has five synthetic MCP interactions after removing the ask's internal search, one matched waitlist signup and one member through each funnel step, four accepted pushes with two merges, one supersession, 12 measured friction minutes, one unknown-cost friction report, one sensitive refusal, one observed model failure, and two missing completions. Earlier synthetic recent events supply the pixel sparkline.

### usage.sql

```text
SET
SET
    day     | environment |   traffic    | entrypoint | interactions | active_members | active_teams
------------+-------------+--------------+------------+--------------+----------------+--------------
 2026-10-11 | development | real         | mcp        |            1 |              1 |            1
 2026-10-11 | development | synthetic    | mcp        |            5 |              1 |            1
 2026-10-11 | development | synthetic    | web        |            1 |              1 |            1
 2026-10-11 | development | unclassified | mcp        |            1 |              1 |            1
 2026-10-10 | development | synthetic    | mcp        |            3 |              1 |            1
 2026-10-09 | development | synthetic    | mcp        |            4 |              1 |            1
 2026-10-08 | development | synthetic    | mcp        |            1 |              1 |            1
 2026-10-07 | development | synthetic    | mcp        |            2 |              1 |            1
 2026-10-06 | development | synthetic    | mcp        |            3 |              1 |            1
 2026-10-05 | development | synthetic    | mcp        |            4 |              1 |            1
(10 rows)
```

### funnel.sql

```text
SET
SET
 environment |  traffic  | waitlisted_signups | signups | key_or_oauth | first_push | first_ask
-------------+-----------+--------------------+---------+--------------+------------+-----------
 development | synthetic |                  1 |       1 |            1 |          1 |         1
(1 row)
```

### knowledge.sql

```text
SET
SET
    day     | environment |  traffic  |   kind   |   source    | pushes | merges | supersessions | friction_minutes | unmeasured_friction
------------+-------------+-----------+----------+-------------+--------+--------+---------------+------------------+---------------------
 2026-10-11 | development | synthetic | friction | claude-code |      2 |      1 |             0 |               12 |                   1
 2026-10-11 | development | synthetic | gotcha   | codex       |      2 |      1 |             0 |                  |                   0
 2026-10-11 | development | synthetic |          |             |      0 |      0 |             1 |                  |                   0
(3 rows)
```

### quality.sql

```text
SET
SET
    day     | environment |  traffic  | entrypoint |      event_name      | events | ask_gap_percent | sensitive_refusals | failures_or_fallbacks | p50_ms | p95_ms
------------+-------------+-----------+------------+----------------------+--------+-----------------+--------------------+-----------------------+--------+--------
 2026-10-11 | development | synthetic | mcp        | ask.performed        |      1 |             0.0 |                  0 |                     0 |    100 |    100
 2026-10-11 | development | synthetic | mcp        | classifier.completed |      1 |                 |                  0 |                     0 |     50 |     50
 2026-10-11 | development | synthetic | mcp        | learning.pushed      |      5 |                 |                  1 |                     1 |        |
 2026-10-11 | development | synthetic | mcp        | model.completed      |      1 |                 |                  0 |                     1 |    700 |    700
 2026-10-11 | development | synthetic | mcp        | search.performed     |      1 |                 |                  0 |                     0 |     40 |     40
 2026-10-11 | development | synthetic | web        | ask.performed        |      1 |           100.0 |                  0 |                     0 |    300 |    300
(6 rows)
```

### stalls.sql

```text
SET
SET
 environment |  traffic  | entrypoint |    event_name     |  purpose  |       stall        |   reason_code   | events
-------------+-----------+------------+-------------------+-----------+--------------------+-----------------+--------
 development | synthetic | mcp        | model.completed   | embedding | observed_failure   | provider_failed |      1
 development | synthetic | mcp        | model.started     | synthesis | missing_completion |                 |      1
 development | synthetic | mcp        | operation.started | push      | missing_completion |                 |      1
(3 rows)
```

## Remaining integration work

- Slack: after verified, deduplicated identity resolution, establish a Slack origin and emit `slack.event_received` and `slack.reply_decided`. Shared services emit push/search/ask automatically. Preserve the safe origin across queued continuations.
- Installer: send OAuth- or member-key-authenticated outcomes to `POST /api/analytics/install`. Reuse an attempt UUID for delivery retries and use a new one for an actual install/doctor retry. Send only fixed step/outcome/agent/platform fields. Anonymous pre-authentication telemetry is not accepted here.
- Hooks: the existing Stop capture gate emits `hook.fired` with a null pushed count. The later agent's push is not inferred to be hook-caused. Session-start hooks and known pushed counts can use `POST /api/analytics/hook`. Quiet sessions still make no request. Do not duplicate the existing capture gate event.
- Better Auth: integrated by the landing merge as described above.

Analytics is best effort. Individual write timeouts and process termination can leave gaps. The default traffic classification is unknown. The first ask funnel step can be a gap, and recent polling is observed use rather than engagement proof.
