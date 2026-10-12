# Hive

A shared memory for your team's coding agents.

Each person adds one MCP server to Claude Code or Codex. Their agents push what they learn to the hive: gotchas, fixes, decisions, how a flaky thing really works. Every agent searches the hive when it starts a task or hits an error. Anyone can ask the hive a question in the web UI and get an answer with citations.

- Landing page: https://gohive.dev
- Dashboard: https://gohive.dev/app
- MCP endpoint: https://gohive.dev/api/mcp

Built in one day at the Lightdash offsite launchathon, 12 October 2026.

## The 5-minute demo

Sign in at https://gohive.dev/app/login with email and password, Google or Slack before you start. Have a terminal open beside the browser.

1. **The pitch (30 seconds).** Open https://gohive.dev. What one agent learns, the whole hive knows.
2. **The comb (45 seconds).** Open https://gohive.dev/app. Each hexagon is a cell: one learning, whose agent brought it, from which repo, and when. Point at the cell that says "Seen 2 times": two agents pushed the same fact and the hive merged them. Click a cell to open the full learning.
3. **Search (35 seconds).** Type `emulator will not boot, not enough disk space`. The hive finds the Android emulator learning from meaning, not keywords. The card shows its score and the signals behind it: vector, text, recency, votes, repo match.
4. **Ask (55 seconds).** In "Ask the hive", ask: `CI is green but the nightly job did not run. What should I check?` A forager flies out and comes back with a jar. The answer joins several learnings. Click a citation chip to open its cell. Point at "What the hive does not know yet": the hive says what it is missing.
5. **Two agents, one hive (75 seconds).** In the terminal run:
   ```
   claude -p "Search the hive for what the team knows about git stash and worktrees, then tell me the rule in two sentences."
   ```
   Claude Code calls `hive_search` on its own. Then start `codex`, type the line below and approve the tool call:
   ```
   Push this to the hive as a gotcha for repo charliedowler/hivemind: <something you learned today>
   ```
   Switch to the dashboard. Within 5 seconds a new cell fills in and "Fresh nectar" shows the arrival with a teal Codex badge.
6. **Nobody asked (20 seconds).** In "Fresh nectar", point at "Stop hook demo's Claude brought nectar from billing-cutoff". That session was only asked to fix a failing test. The Stop hook asked it once, before it stopped, what a teammate would otherwise have to rediscover.
7. **Install (25 seconds).** Open https://gohive.dev/app/install. Copy the OAuth command. Sign in through the browser and allow access to your hive. That is the whole setup for a teammate.
8. **Close (15 seconds).** Open a cell and vote it useful or outdated. The hive ranks on that feedback.

Screenshots of every step at 1280 and 390 wide are in [docs/screenshots](docs/screenshots).

## Install for a teammate

**MCP auth is OAuth-first.** Web sign-in uses email and password, Google or Slack. Create a team, or join with an invite link or an allowed work domain. Email accounts verify a six-digit Resend code within 15 minutes.

For Claude Code:

```
claude mcp add --transport http hive https://gohive.dev/api/mcp --scope user
```

Use `/mcp` in Claude Code to authenticate. For Codex:

```
codex mcp add hive --url https://gohive.dev/api/mcp
codex mcp login hive
```

No `HIVE_KEY` or pasted key is needed. The client discovers the authorization server from the MCP endpoint's 401 challenge, opens the browser, and asks you to consent. The access token is bound to this MCP resource and your hive. CIMD uses the MCP 2026-07-28 profile. Dynamic client registration remains available for older clients.

The Install page gives the instruction block and a Claude Code Stop hook. Quiet sessions make no network or model call. Useful sessions use a Jev sharing gate, then ask the agent at most once to push a learning. OAuth hooks read and refresh `~/.hive/oauth.json`; agent credential stores remain private. Both the MCP endpoint and `/api/app/capture` accept the same team-scoped OAuth token. In headless runs, the hook asks the agent to repeat its final answer because the caller reads only the last message.

For headless and CI use only, create a key on `/app/account`. The Install page lists key commands last:

```
claude mcp add --transport http hive https://gohive.dev/api/mcp --header "Authorization: Bearer <YOUR_KEY>" --scope user
```

The older key-based installation checks below remain historical evidence. OAuth release checks are recorded in the authentication report.

Both install paths were run for real against production on 12 October 2026: Codex CLI 0.162.1 pushed two learnings and searched them back, and Claude Code 2.1.296 pushed one from the `Stop` hook. A non-interactive `codex exec` refuses MCP tool calls under its default approval policy; use interactive `codex` and approve the call, or pass `--dangerously-bypass-approvals-and-sandbox` in a sandbox you trust.

## MCP tools

| Tool            | What it does                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hive_push`     | Stores a learning, insight or friction point: title, markdown body, kind, tags, repo, paths, confidence, source, area, measured minutes lost, blocked and workaround. Redacts secrets. Merges confirmed duplicates. Accepts `supersedes`, `verify_after` and optional redacted evidence. |
| `hive_search`   | Hybrid search of current cells with kind and tag filters; `include_history` opts into past guidance. Returns ranked learnings with ids and scores.                                                                                                                                                                              |
| `hive_ask`      | Answers a question from the team's learnings, with citations to learning ids, a confidence and the gaps.                                                                                                                                                     |
| `hive_recent`   | Lists what the team learned since a time, such as `24h` or `7d`, with a kind filter.                                                                                                                                                                         |
| `hive_browse` | Lists files and folders in the team’s generated knowledge tree. |
| `hive_read` | Reads one relative Markdown path from the tree. |
| `hive_snapshot` | Returns a private read-only tarball link that expires after 15 minutes. |
| `hive_feedback` | Votes a learning `up`, `down` or `outdated`.                                                                                                                                                                                                                 |

## Architecture

```
  Claude Code            Codex               Browser
      |                    |                    |
      | MCP, Streamable HTTP                    | cookie session
      | OAuth access token or headless key     |
      v                    v                    v
+------------------------------------------------------------+
|  apps/web  (Next.js App Router on Vercel)                  |
|                                                            |
|  /api/mcp          Better Auth MCP OAuth, mcp-handler 2.x            |
|  /api/app/*        JSON routes for the dashboard           |
|  /api/early-access landing form                            |
|  /, /app, /app/members, /app/install                       |
|                          |                                 |
|                          v                                 |
|  src/server/auth.ts   keys and sessions -> HiveContext     |
|  src/server/hive.ts   push, search, ask, recent, feedback  |
|                       every query filters by ctx.teamId    |
|        |                    |                   |          |
+--------|--------------------|-------------------|----------+
         v                    v                   v
   Neon Postgres        OpenAI embeddings    Claude API
   pgvector (HNSW)      text-embedding-      claude-sonnet-5-5 (ask)
   tsvector (GIN)       3-small              claude-haiku-5-5 (tags)

  packages/core: zod schemas, contracts, ranking, redaction
  design/system: @hivemind/design-system, the pixel-art tokens, sprites and components
```

**Push.** Validate and redact, classify sharing and kind, embed, then compare up to four nearby current cells in the same team, repo and kind. Jev judges whether each candidate repeats, updates or contradicts the incoming fact. Exact matching facts and confident duplicate judgments merge counts and metadata without replacing the body. Corrections create a separate cell and a proposed supersession. Explicit `supersedes` accepts the replacement atomically; same-author corrections and very confident environment updates can also accept it. Otherwise an admin or two distinct members decide in Conflicts. A Jev outage never authorises an automatic correction. Repeated friction reports retain their measured costs.

**Search.** Candidates come from the nearest vectors and from Postgres full-text search. `rankCandidates` in `packages/core` scores them:

```
score = 0.55 * vector + 0.25 * text + 0.10 * recency + 0.10 * votes
        + 0.08 when the repo matches
        scaled by confidence, lifecycle and verification age
        and by 0.4 when outdated votes outnumber up votes
```

Without embeddings the text signal takes the vector weight, so the hive still works with only Postgres.

**Ask.** Jev first reranks current results for direct relevance, then checks whether the top 8 search hits directly answer the question before they go to Claude Sonnet with a structured output schema. Weak evidence returns an honest gap. When Jev is unavailable, a conservative vector or lexical coverage check gates synthesis. Friction summaries use counted reports directly. The model answers only from those learnings and cites ids inline. The server drops any citation that is not in the retrieved set. If the model call fails or refuses, the hive returns the top hits as a plain list. The server adds the accepted replacement chain, an as-of date and verification warnings with historical citations.

TypeSafe Jev 1.13.0 supplies typed judgments for push, capture and ask. The server pins the version and makes no retries. Push/capture/ask gates use 500 ms; relation, topic and relevance batches use 2 seconds. Decision logs contain no cell text. The current [TypeSafe API](https://docs.typesafe.ai/api) and [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) define the request and probability contracts. The full Hive contract is in [docs/SPEC.md](docs/SPEC.md).

## Learning storage and lifecycle

Postgres is the source of truth: typed metadata, a Markdown body, explicit lifecycle and immutable content versions with field diffs. Private Vercel Blob holds redacted push evidence and the generated Markdown tree. A durable database queue retries failed uploads. Blob failure does not roll back an accepted learning. The [decision document](docs/learnings-backend.md) sets the boundaries.

Cells are fresh, confirmed, superseded, outdated or retracted. Superseded and retracted cells remain readable, but default search and ask use fresh and confirmed cells. Verification horizons range from 14 days for environment facts to 180 days for decisions. Expired cells say “Verify before use” and receive less weight. Authors and admins can edit through the revision-checked API; edits preserve versions. New facts replace old ones through `hive_push({ ..., supersedes: "lrn_existing" })`.

The [Conflicts panel](https://gohive.dev/app/conflicts) compares both sources. The [tree browser](https://gohive.dev/app/tree) exposes repos, topics, people, friction and INDEX.md. Citation chips show titles; IDs are available in tooltips and cell details. Local archives are read-only views, so edits must return through `hive_push`.

Connect a private Vercel Blob store and set `BLOB_READ_WRITE_TOKEN` on the server. Run `pnpm --filter web knowledge:rebuild` with database and Blob credentials to rebuild every team and drain pending evidence. Changed files use content-addressed object keys. A database revision check prevents an older worker from publishing over a newer tree. Reads retry pending publication, and verification deadlines invalidate the tree even without another push.

Snapshots are limited to 10,000 cells and 50 MB of source Markdown. The download URL is a bearer capability; keep it private. It expires after 15 minutes and stops working if its member is removed. There is no automatic Blob garbage collection or scheduled worker yet; the rebuild command is the recovery path. Evidence collection starts with migration 0010; older raw pushes cannot be reconstructed.

## Security notes

- **API keys are hashed at rest.** A key is `hm_` plus 32 random bytes. The database stores only its SHA-256 hash and a 10 character display prefix. The raw key is shown once. Legacy web sessions keep their hashes. Better Auth stores its new session tokens in the mapped session table.
- **Team isolation is on every query.** Each service function takes a `HiveContext` from a verified OAuth token, headless key or web session. Token claims are checked against current membership. Every query on team data filters by `ctx.teamId`. No function accepts a team id from user input. Integration tests prove that team B cannot search, read, list or vote on team A's learnings.
- **Secrets are redacted on push.** Common key shapes, JWTs, private key blocks and database URL passwords become `[redacted]` before storage and before embedding.
- **Learning text is untrusted input to the model.** The ask prompt marks learnings as data to quote, never instructions to follow.
- **Verified email joins.** Email is lowercase and unique. Codes use scrypt hashes, expire after 15 minutes and allow five attempts. Sending and verification have database rate limits. Missing Resend configuration disables email joins with a clear message.
- **Team admins.** The creator can allow their own verified work domain, rotate an invite, revoke keys, remove members, and retract or mark cells outdated. Public email domains cannot join by domain. Invites use hashes and expire after seven days. The raw invite appears only when created or rotated.
- **Your account.** `/app/account` shows your name, email status and key labels, creation and last-use dates. You can revoke your own keys and sign out. Existing members keep their IDs, keys, roles and live legacy sessions. Members with email set their first password through an email-code reset. Members without email use a live legacy session to verify an address on their account page; their headless keys remain valid.

## What is stubbed or missing

- The comb polls every five seconds.
- No Codex Stop hook equivalent. Codex uses the AGENTS.md instruction block.
- Team admins can inspect usage, onboarding, knowledge, quality and stalls at `/app/admin/analytics`. General usage quotas are not implemented.
- Google consent is in Testing. Only configured test accounts can complete Google sign-in until the OAuth app is published.
- Jev thresholds have a small policy eval and live smoke check, not a calibrated team dataset.
- The Stop gate uses text and explicit local activity. Unsupported transcript formats skip capture.
- Ask keeps no conversation state.
- Two original seed authors are fictional. Test members from install checks are labelled as demos.

## Develop

Needs Node 24 and pnpm 10.

```
pnpm install
docker run -d --name hivemind-pg -e POSTGRES_USER=hivemind -e POSTGRES_PASSWORD=hivemind \
  -e POSTGRES_DB=hivemind -p 127.0.0.1:54329:5432 pgvector/pgvector:pg18
cp apps/web/.env.example apps/web/.env.local   # then add OPENAI_API_KEY and ANTHROPIC_API_KEY
pnpm --filter web db:migrate
pnpm dev
```

```
pnpm typecheck
pnpm test          # integration tests run when DATABASE_URL is set
pnpm build
```

Seed the six build observations with an existing member key. The default author label is Charlie. The older multi-author seed requires verified member keys and cannot create authors through an unverified invite:

```
HIVEMIND_URL=http://localhost:3000 HIVE_KEY=<key> pnpm --filter web seed -- --file scripts/seed-r3.json
```

Set `PUBLIC_URL=https://gohive.dev` for deployed environments. Metadata, invite links and install snippets use this URL. Without it, the app uses the request host. `www.gohive.dev` redirects to `gohive.dev` and keeps the path and query.

Production deploys from `main` through the Vercel GitHub integration. Run `pnpm --filter web db:migrate` against the production `DATABASE_URL` before a deploy that needs a new migration.

## Friction and insights

Cells can be learning, gotcha, decision, snippet, incident, insight or friction. An insight describes how the team works. Friction records what slowed a forager down: area (repo, tool, process, docs, environment or people), optional measured minutes lost, whether it blocked progress, and an optional workaround.

Choose a kind on the comb. Friction and insight cells have distinct pixel badges. The Friction panel cites this week's reports, ranks areas by measured minutes lost and groups recurring titles. Ask `what is slowing the team down` for the same counts and citations. Unknown costs stay unknown; they are excluded from the total. Each push contributes its own cost, including repeated reports merged into one cell.

Six dated build observations are in apps/web/scripts/seed-r3.json. They contain no invented durations. Push them with an existing verified member's key: `pnpm --filter web seed -- --file scripts/seed-r3.json`. New authors must verify email and supply their own keys; the seed script cannot bypass verification.

Run the opt-in Jev smoke test with a server key in the environment:

```
TYPESAFE_LIVE_TEST=1 pnpm --filter web test src/server/classify.live.test.ts
```

The normal test suite makes no TypeSafe calls. `classify.test.ts` checks pure decision mapping, quiet-session gates, one request, no retries and invalid-response fallback. The capture route requires a member key and has a per-member rate limit. Update an installed Stop script from the Install page to get the new gate.

Production smoke checks on 12 October 2026 measured Jev at 205 ms for a friction push, 151 ms for useful Stop capture and 160 ms for a relevant ask from Vercel. A weak retrieval was rejected at probability 0.03 in 152 ms. A quiet capture made no model call. These are individual checks, not percentile benchmarks. Screenshots prefixed r3- show verified email, membership, kind filters and the Friction panel at 1280 and 390 pixels.

## Analytics and event logs

The [analytics contract](docs/analytics.md) describes the private append-only event ledger, privacy limits, five SQL reports and merge-time migration. Team admins can open `/app/admin/analytics` to inspect their team with pixel tables and bars. Waitlist signups remain in `early_access`. Set `HIVE_REPORTING_DATABASE_URL` to a private ledger-only reporting login for a later Lightdash connection. No Lightdash project is created here.
## Better Auth and forager access

[Better Auth](https://better-auth.com/docs/plugins/mcp) owns passwords, email codes, Google and Slack sign-in, sessions, OAuth consent, PKCE, JWT signing and refresh. Its Drizzle user model maps to `members`; its session model maps to `web_sessions`. No old password hashes exist. Existing verified emails link to the same member, so keys and cell attribution retain their IDs. A signed-in account with no team has no dashboard or MCP context until verification and enrollment succeed.

`GOOGLE_CLIENT_ID` plus `GOOGLE_CLIENT_SECRET` enable the Google button. `SLACK_CLIENT_ID` plus `SLACK_CLIENT_SECRET` enable Slack. Missing pairs hide the buttons. `SLACK_SIGNING_SECRET` is reserved for the later Slack integration and is not used for sign-in. Production requires `BETTER_AUTH_SECRET`; `BETTER_AUTH_URL` sets the authorization origin. `PUBLIC_URL` supplies the protected MCP resource. Development can run without provider credentials; the local secret fallback is never used in production.

Apply `0011_better_auth.sql` and `0012_mcp_oauth.sql` with the repository migrate script from committed main before deploying the auth code. SQL uses guarded schema changes, lock and statement timeouts. Rollbacks refuse to discard linked accounts or populated OAuth grants. Old session hashes are not copied into raw Better Auth tokens. They remain readable through a compatibility path until expiry or sign-out. API keys never open a web session.

New members join an allowed verified work domain as members, or use a valid unexpired invite. Public email providers need an invite. A new team creator becomes its admin. Client-supplied team IDs and roles cannot change membership. MCP tokens carry server-derived member and team claims, and all tools recheck the current membership before querying that hive.

`/.well-known/oauth-protected-resource`, its `/api/mcp` alias, authorization-server metadata and `/oauth2/*` aliases reach the Better Auth handler. Its canonical endpoints live under `/api/auth`. DCR requests from older desktop clients that omit `application_type` are normalized to native only for native redirect shapes; Better Auth still validates every redirect and requires PKCE. Hook login clients must request `offline_access` explicitly to obtain a refresh token.

Executor: add a remote MCP server in your executor organisation with server URL `https://gohive.dev/api/mcp` and OAuth authentication. Sign in and allow access to your hive.
