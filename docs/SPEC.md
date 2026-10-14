# Hive MVP spec

Hive is a shared memory for a team's coding agents. Each person adds one remote MCP server to Claude Code or Codex. Agents push learnings to the hive. People browse and search cells in the dashboard. They ask through their agents with `hive_ask`; Slack bot support is in progress.

This file is the contract between implementation rounds. When code and spec disagree, fix the code or change the spec in the same commit.

## Rules for every round

- No code comments unless asked. Self-documenting names.
- TypeScript strict. Node 24. pnpm workspace.
- No secrets in the repo. `.env*` is gitignored.
- Every database query that touches team data takes `teamId` from an authenticated `HiveContext`. No function accepts a team id from user input.
- UI copy and docs: short sentences, no em dashes, no customer names.

## Human vocabulary

The seven core terms are hive, cell, agent, repo, replaced, outdated and kept private. Signed-in pages and human replies use learning, decision or friction for cell types. Current cells have no state label until repeated, then show Seen N times. Historical cells show Replaced, Outdated or Removed. Privacy controls are What Hive keeps. Slack posts are weekly updates. Human replies describe cell changes directly. Internal tool names, schemas and stored enum values stay unchanged.

## Layout

```
apps/web                     Next.js App Router (Vercel root directory)
  drizzle/*.sql              hand-written SQL migrations, applied in file order
  scripts/migrate.ts         migration runner (tsx)
  scripts/seed.ts            pushes demo learnings through the MCP endpoint
  src/app                    routes
  src/mcp/server.ts          registerHiveTools(server, getContext)
  src/server/db/             client.ts, schema.ts (Drizzle, postgres.js driver)
  src/server/auth.ts         headless keys, legacy session compatibility
  src/server/better-auth.ts  web sign-in, enrollment hooks, MCP OAuth
  src/server/hive.ts         the service: every read and write goes through here
  src/server/llm/            embeddings.ts, synthesize.ts, tagger.ts (index.ts re-exports all three)
  src/lib/install.ts         install snippet generators (pure)
packages/core                @hivemind/core: zod schemas, contracts, ranking, redaction
design/system                @hivemind/design-system: tokens, pixel sprites and components, consumed by apps/web
```

## Environment

| Name                | Used for                                                     | Absent means                                                  |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `DATABASE_URL`      | Postgres (Neon pooled URL in production)                     | routes that need the database return 503 with a clear message |
| `OPENAI_API_KEY`    | `text-embedding-3-small` embeddings (1536 dims)              | full-text search only, dedupe by normalized title             |
| `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` synthesis, `claude-haiku-5-5` tagging    | `hive_ask` returns an extractive answer, no auto tags         |
| `TYPESAFE_API_KEY` | Jev push, capture and relevance judgments | deterministic policies and Haiku tagging fallback |
| `RESEND_API_KEY` / `EMAIL_FROM` | verification email delivery | email joins return a clear disabled response |
| `RESEND_EMAIL_DOMAIN` | configured sender domain for delivery operations | sender-domain configuration needs checking |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in | Google button hidden |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack OpenID Connect sign-in | Slack button hidden |
| `BETTER_AUTH_SECRET` | session, verification and OAuth secrets | production authentication refuses to start; development has a local fallback |
| `BETTER_AUTH_URL` | authorization origin | uses publicUrl() |
| `PUBLIC_URL`        | canonical URL in metadata, install snippets and invite links | falls back to the request origin                              |

Local Postgres for development: `postgres://hivemind:hivemind@127.0.0.1:54329/<database>` (Docker container `hivemind-pg`, image `pgvector/pgvector:pg18`, extension `vector` 0.8).

Driver: `postgres` (postgres.js) with `drizzle-orm/postgres-js`, `prepare: false`, small pool (`max: 3`), one client cached on `globalThis`.

## Ids and keys

- Ids are text with a prefix and 12 lowercase base32 characters: `team_`, `mem_`, `key_`, `lrn_`, `psh_`, `ses_`, `ea_`, `ask_`.
- API key format: `hm_` + 32 random bytes as base64url. The database stores `sha256(key)` as hex and a display prefix (first 10 characters). The raw key is shown once.
- Invite code: `hive-` plus random bytes. Only its SHA-256 hash is stored. It expires after seven days. The Members page shows a rotated code once.
- Web sessions use Better Auth cookies, secure in production, httpOnly and sameSite lax. Legacy `hm_session` hashes keep working until their 30-day expiry or sign-out. API keys cannot create web sessions.

## Tables

- `teams` (id, name, invite_code unique hash, invite_expires_at, created_at)
- `members` (id, team_id, name, email unique nullable, email_verified, actor_type human or agent, role, removed_at, created_at, last_seen_at)
- `auth_accounts`: human provider and password accounts. Retired provider rows remain for historical attribution.
- `agent_credentials`: agent and owner IDs, hashed bearer, machine, pending phrase, claim expiry and revocation.
- `agent_connection_requests`: verified-owner connection requests with a hashed polling secret and single-use email approval.
- `hive_agent_owners`: the unified owner relation for new credentials and historical owner bindings.
- `join_share_offers`: each human's organisation offer and answer. Project grants record the human instruction; all_selected covers future selections.
- `agent_owner_invites`: one owner invite per agent-created team; stores the expected owner email, invite hash, expiry, delivery time and accepting human.
- `api_keys` (id, team_id, member_id, key_hash unique, prefix, label, created_at, last_used_at, revoked_at)
- `web_sessions` (id, member_id, team_id, token_hash unique, created_at, expires_at)
- `learnings` (id, team_id, member_id, title, body, kind, tags text[], repo, paths text[], area, cost, blocked, workaround, classification jsonb, confidence real, source, session_ref, push_count int default 1, up_votes, down_votes, outdated_votes, created_at, updated_at, last_pushed_at)
  - plus `search tsvector` generated from title (weight A), tags (B), body (C); GIN index. Not in the Drizzle schema; raw SQL only.
  - plus `embedding vector(1536)` nullable; HNSW cosine index. Added by a separate migration that may fail when pgvector is absent. Not in the Drizzle schema; raw SQL only. The service detects the column once per process and caches the answer.
  - indexes: (team_id, created_at desc), (team_id, repo)
- `learning_pushes` (id, learning_id, team_id, member_id, source, session_ref, merged boolean, area, cost, blocked, classification jsonb, created_at): one row per push, including merged duplicates
- `feedback` (learning_id, member_id, team_id, vote, note, created_at, updated_at; primary key (learning_id, member_id)): one vote per member per learning; the counters on `learnings` are recomputed in the same transaction
- `ask_log` (id, team_id, member_id, question, answer, cited_ids text[], synthesized boolean, classification jsonb, created_at)
- `early_access` (id, name, email, company, team_size, source, created_at)

The migration runner keeps a `_migrations` table. It applies the pgvector migration inside its own try/catch and logs a warning when it fails.

## Agent sign-in and team access

POST /api/agents/bootstrap accepts email, agentName, machine and optional joinPhrase. Email is canonicalised and any provider is allowed. Shared limits are five per IP and email each hour, and 100 globally. A new owner receives a provisional personal hive, a hashed bearer agent credential and one claim email. A verified human receives only a single-use connection link until they approve that machine.

The bearer authenticates MCP and hook endpoints as the agent actor. Capture uses the owner's capture policy: by default every Git repository with a remote, minus exclusions; or only listed projects when the owner chooses that. Repositories without a remote and home directories never capture. Unclaimed owners and their agents have no organisation access. A claim link, or verified Google or Slack sign-in with the same email, claims the human, runs domain enrollment and completes pending joins or outside-domain requests. Agents follow claimed owners as members only. Unclaimed accounts, credentials and private cells expire after seven days.

Every organisation join records a sharing offer. Yes creates one all_selected grant for everything Hive captures for the owner, now and in future. The web join step ticks Yes by default and records the answer when the person joins; unticking records Not now. Choose projects creates exact pattern grants atomically; nothing is pre-ticked. Not now creates no grants and remains available on Account or Team. All grants record the human instruction and keep originals personal. Agent status returns offers; hive_share_with saves the explicit answer.

## Contracts (`@hivemind/core`)

```ts
type HiveContext = {
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
};

type LearningView = {
  id: string;
  title: string;
  body: string;
  kind: LearningKind;
  tags: string[];
  repo: string | null;
  paths: string[];
  confidence: number;
  source: LearningSource;
  author: { id: string; name: string };
  pushCount: number;
  votes: { up: number; down: number; outdated: number };
  createdAt: string;
  updatedAt: string;
  lastPushedAt: string;
};

type SearchHit = LearningView & {
  score: number;
  signals: {
    vector: number | null;
    fts: number;
    recency: number;
    votes: number;
    repoMatch: boolean;
  };
};

type PushResult = {
  id: string;
  merged: boolean;
  pushCount: number;
  redactions: number;
  learning: LearningView;
};
type AskResult = {
  answer: string; // markdown, cites inline as [lrn_xxx]
  citations: { id: string; title: string; why: string }[];
  confidence: "high" | "medium" | "low";
  gaps: string | null;
  synthesized: boolean; // false = extractive fallback
};
type FeedbackResult = {
  id: string;
  votes: { up: number; down: number; outdated: number };
};
type MemberView = {
  id: string;
  name: string;
  joinedAt: string;
  lastSeenAt: string | null;
  learningCount: number;
};
```

## Service (`apps/web/src/server/hive.ts`)

```ts
pushLearning(ctx, input: HivePushInput): Promise<PushResult>
searchLearnings(ctx, input: HiveSearchInput): Promise<SearchHit[]>
askHive(ctx, input: HiveAskInput): Promise<AskResult>
recentLearnings(ctx, input: HiveRecentInput): Promise<LearningView[]>
recordFeedback(ctx, input: HiveFeedbackInput): Promise<FeedbackResult>
getLearning(ctx, id: string): Promise<LearningView | null>
listMembers(ctx): Promise<MemberView[]>
teamOverview(ctx): Promise<{ teamName: string; inviteCode: string; learningCount: number; memberCount: number; repos: string[] }>
submitEarlyAccess(input: EarlyAccessInput): Promise<{ id: string }>
```

Auth (`apps/web/src/server/auth.ts`):

```ts
createTeam(input: { teamName: string; memberName: string }): Promise<{ ctx: HiveContext; apiKey: string; inviteCode: string }>
joinTeam(input: { inviteCode: string; memberName: string }): Promise<{ ctx: HiveContext; apiKey: string } | null>
authenticateApiKey(rawKey: string): Promise<HiveContext | null>   // updates last_used_at and last_seen_at
issueApiKey(ctx: HiveContext, label?: string): Promise<{ apiKey: string; prefix: string }>
startWebSession(ctx: HiveContext): Promise<void>                  // sets the cookie
getWebContext(): Promise<HiveContext | null>                      // reads the cookie
endWebSession(): Promise<void>
```

## Behaviour

### Push

1. Validate with `hivePushInput`. Normalize repo to lower case `owner/name` (strip `https://github.com/`, `.git`). Normalize tags to lower case kebab, deduped.
2. Redact secrets in title and body with `redactSecrets` from core (API key shapes such as `sk-`, `sk-ant-`, `ghp_`, `github_pat_`, `xox[bap]-`, `AKIA…`, `hm_…`, JWTs, `-----BEGIN … PRIVATE KEY-----` blocks, `postgres://user:pass@` passwords). Replace with `[redacted]`. Return the count.
3. Classify the redacted observation with Jev before any embedding or write. Refuse high sensitive-data probability. Keep an explicit caller kind, otherwise use a confident suggestion or learning. Store the raw typed answers. Embed `title + "\n\n" + body` (truncate to 8000 characters) when `OPENAI_API_KEY` exists. The call has a 6 second timeout and two retries. An embedding failure never fails the push.
4. Select up to four current candidates in the same team, repo and kind, using normalized title equality or vector similarity >= 0.8. Jev compares same/update/contradiction/unrelated and checks named tool/service tags. Inside a team advisory lock, reread candidates and reject judgments against an old revision. Dedupe only an exact normalized title plus body, or a same-fact judgment >= 0.9. Friction also groups equal titles unless Jev finds an update or contradiction. Merge counts, tags, paths and confidence without overwriting the body.
5. Otherwise insert a new learning, its push event and a redacted evidence outbox record. `supersedes` forces a new cell and atomically accepts a replacement; it never dedupes. Similar corrections with confidence >= 0.7 create candidate edges. A same-author correction >= 0.9 accepts automatically. Environment facts with matching area, judgment >= 0.98 and caller confidence >= 0.95 also accept. Other edges need an admin or two distinct active member votes.
6. When Jev is unavailable, tags are empty and `ANTHROPIC_API_KEY` exists, schedule `suggestTags` with `after()` from `next/server` and store up to 5 tags. This never delays or fails the push.

### Search

1. Candidate set = the 40 nearest learnings by cosine similarity (when the query embeds and the column exists), kept when the similarity is at least 0.30 or the row is also a text candidate, union the top 40 text candidates. A text candidate matches any query lexeme (`plainto_tsquery` with OR) and covers at least half of the distinct query lexemes; it is ordered by `ts_rank_cd`. When both sets are empty, fall back to a prefix `to_tsquery` on the query words. All inside `team_id = ctx.teamId`. `tags` is a hard filter (array overlap). `repo` is a boost, not a filter.
2. Rank with `rankCandidates` from core (pure, unit tested):
   - `vector` = cosine similarity clamped to 0..1
   - `fts` = rank divided by the max rank in the candidate set
   - `recency` = `exp(-ageDays / 45)` on `last_pushed_at`
   - `weightedNetVotes` = the sum of current up (+1) and down (-1) contributions, each multiplied by `2^(-ageDays / 90)`. Age uses the original receipt timestamp, or the legacy feedback update timestamp. Outdated votes do not add weight. Repeat pushes do not count as useful feedback.
   - `votes` = `clamp(0.5 + weightedNetVotes / 6, -0.5, 1.5)`. Three fresh net useful outcomes double the neutral votes term from 0.5 to 1. Useful outcomes already count as up votes and never count twice. The capped term leaves text and vector relevance dominant.
   - `score = 0.55 * vector + 0.25 * fts + 0.10 * recency + 0.10 * votes`. Without a vector signal: `0.70 * fts + 0.15 * recency + 0.15 * votes`.
   - plus 0.08 when the repo matches, times `0.85 + 0.15 * confidence`, times 0.4 when `outdated > up` and `outdated >= 1`.
3. Default search, ask and recent exclude cells before candidate limits when down votes outnumber up votes and there are at least two down votes, when a current evidenced contradicted outcome is newer than the latest current useful outcome (or there is no useful outcome), or when lifecycle is superseded, outdated or retracted. Evidence timestamps are report receipt timestamps. Supported contradicted outcomes record an evidence stamp even when the check is cited in the outcome text; later privacy redaction preserves that stamp. Replaced and withdrawn contributions do not affect standing. `include_history: true` on all three tools includes these cells; direct ID reads also retain them. Withdrawal recomputes standing immediately. Counts and outcome stamps use the projected cell audience, never votes from another publication or its personal original. The read model exposes `unhelpfulLabel` ("Marked unhelpful by N"), `retrievalExcluded` and `feedbackStanding`; the comb can keep showing hidden cells. Scale by lifecycle (confirmed 1, fresh 0.95, historical 0.25) and verification age (0.7 after the deadline). Return the top `limit` hits with signals.

### Ask

The shared ask service, relevance gate and MCP `hive_ask` tool serve agent requests and the Slack integration. Keep `POST /api/app/ask` available while the Slack integration is in progress; the dashboard does not call it.

1. `searchLearnings` with the question, limit 8.
2. No hits: return a fixed answer that says the hive has nothing on this yet, `synthesized: false`, `confidence: "low"`.
3. Give Jev each candidate's vote counts, current outcome counts, latest outcome and timestamps, and lifecycle. The reranker filters excluded cells unless history is requested; no model response can add candidates. Rerank each hit with a Jev relevance probability, scaling its score by `0.5 + 0.5 * probability`; use the original ranking on failure. Gate retrieved evidence with Jev. Weak evidence returns a gap before synthesis. Empty retrieval skips Jev. On an outage require a vector similarity of at least 0.55 or 75% lexical coverage without vectors. Then call `claude-sonnet-5-5` with structured output (`client.messages.parse` and `zodOutputFormat`), `output_config.effort: "low"`, `max_tokens: 4000`. The prompt gives each learning as a block with its id, title, kind, repo, tags, author, date, votes and body. The model must answer only from these learnings, cite ids inline as `[lrn_xxx]`, say what is missing in `gaps`, and prefer newer and upvoted learnings when they conflict. Do not pass `temperature`, `thinking: disabled`, a prefill or forced `tool_choice`: this model rejects them.
4. Drop citations whose id is not in the retrieved set. On `stop_reason: "refusal"`, any API error, or a missing key: return the extractive fallback (top 3 hits as a bullet list with ids), `synthesized: false`.
5. Append an as-of date and overdue verification warnings. Only include the accepted replacement chain (up to 16 links) and its historical citations when `include_history: true`. If there are no answer citations, do not manufacture a chain. Write an `ask_log` row.

### Recent

`since` accepts an ISO datetime or `<n>m`, `<n>h`, `<n>d`, `<n>w`. Search and recent accept a hard kind filter. Order by `last_pushed_at desc`. Apply the same feedback and lifecycle inclusion policy before the limit. `include_history: true` includes hidden cells.

### Feedback

Upsert the member's vote. Recompute the three counters. Unknown id in this team: a not-found error, never another team's row.

## MCP endpoint

**MCP auth is OAuth-first.** `/api/mcp` uses stateless Streamable HTTP through mcp-handler 2.x. Missing or invalid tokens receive 401 with the RFC 9728 `WWW-Authenticate` challenge. Discovery advertises the canonical protected resource, CIMD support and the DCR fallback. `jwt()`, `mcp()` and `cimd({ metadataProfile: "mcp-2026-07-28" })` share one Better Auth instance. Both DCR controls are explicitly enabled. The secure Node CIMD transport pins public DNS results and rejects redirects.

`requireMcpAuth` verifies the signature, issuer, audience, expiry and hive scope. It also verifies DPoP when used. The token's server-derived `hive_member_id`, `hive_team_id` and subject must identify the same current active membership. The resulting HiveContext reaches tools through AuthInfo.extra. Legacy `hm_` bearer keys remain an independent headless/CI path. Web cookies alone cannot authorize MCP. `/api/app/capture` uses the same shared bearer helper and team binding.

Retrieval results use compact Markdown with cell IDs. Capture, correction and feedback results use JSON with reviewable fields and receipts. Tool errors use isError and a one-line cause.

## Web

- `/` landing: pitch, how it works, early-access form (name, email, company, team size). The form writes an `early_access` row and shows a thank-you state.
- `/app/login`: Sign in, Create a team and Join tabs. Sign-in uses email/password or a configured Google/Slack provider. Create/join collect a password and verify email with a code. Join accepts an invite link/code or an allowed work domain. No API key form or raw key appears here.
- `/app/join`: a verified signed-in account without a team chooses a hive. It resumes an MCP login after enrollment.
- `/app/consent`: verifies the signed OAuth query before displaying the client, hive, identity, scopes and requested profile claims. Allow and Cancel complete the Better Auth flow.
- `/app`: the comb, one hexagonal cell per learning (title, repo, whose agent, time, votes, status, push count), polling every 5 seconds; a cell opens the full learning with kind, tags, paths, feedback and a copyable id. Status is outdated when outdated votes outnumber up votes, confirmed when it has up votes or more than one push, otherwise fresh. Search box whose result cards show the score and every ranking signal. Asking is available through MCP, with Slack bot support in progress. The dashboard has no question input or answer history. The cell shows automatic replacements, merges, outdated markings and retractions in plain words, with a link to the other cell and a human-readable time. Admins can reverse once, immediately, with the default audit reason "Admin requested reversal". The resulting line shows "Reversed just now". An optional Add a note control edits that actor's reversal record. Show history in the cell changes section includes related replaced, outdated and retracted cells; version and outcome history remain available separately. Legacy records without valid snapshots have no Reverse button. The service retains team, visibility, admin, snapshot and stale-state checks. The separate Decisions page is removed.
- All UI comes from `@hivemind/design-system`. `design/system/readme.md` sets the vocabulary and the voice.
- Signed-in navigation: Hive (`/app`), Team (`/app/team`), Connect (`/app/connect`) and the avatar menu. The menu shows the member and team names, Account and Sign out. Switch team appears only for more than one active membership and signs out before sign-in. The current account model has one team per member.
- `/app/team`: Members, Slack, What Hive keeps and Export, in that order. Members can read the sections; team admins manage them. Export uses the existing archive control. Capture settings use the current component until the team-only view lands.
- `/app/connect`: the one-command installer comes first. Keys for CI and headless setups and manual setup are collapsed below it. Members create, copy and revoke their own keys here. Manual setup remembers the selected Claude Code, Codex or Executor tab in local storage.
- `/app/account`: the name form and signed-in email are visible. Change email reveals the existing verification flow. Only accounts with a stored password see Change password; its form is collapsed. Keys live on Connect.
- Redirects: `/app/members` to `/app/team`, `/app/settings/slack` to `/app/team#slack`, `/app/settings/capture` to `/app/team#keeps`, and `/app/install` to `/app/connect`.
- `/app/account` remains in the avatar menu. `/app/conflicts` and `/app/admin/analytics` redirect to `/app`; `/app/tree` redirects to `/app/team#export`; `/app/settings/slack/digests` redirects to `/app/team#slack`. The separate `/app/switch-account`, `/waitlist`, `/api/waitlist` and root `/settings/capture` routes are removed. The landing early-access form remains. `/api/analytics/page`, `/api/analytics/error` and `/api/app/analytics/view` are removed; authenticated `/api/analytics/install` and `/api/analytics/hook` reports remain. Access-error pages offer Sign out directly.

- Web API routes live under `/api/app/*` and authenticate with the session cookie. They call the same service functions as the MCP tools.

## Web HTTP API

All bodies are JSON. Errors are `{ "error": "<one line>" }` with a 4xx or 5xx status. Routes under `/api/app/*` other than `teams`, `join`, `email`, `capture` and `session` need the session cookie and return 401 without it. Every body is validated with the zod schema from core.

| Route                                       | Body                         | Success                                                                                 |
| ------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `POST /api/early-access`                    | `EarlyAccessInput`           | 201 `{ ok: true }`                                                                      |
| `POST /api/app/teams` | any | 410; use Better Auth signup and enrollment |
| `POST /api/app/join` | any | 410; use Better Auth signup and enrollment |
| `POST /api/app/session`                     | any | 410; API-key web sign-in is removed |
| `DELETE /api/app/session`                   | none                         | 204, clears the cookie                                                                  |
| `GET /api/app/feed?since=7d&repo=&limit=50` | none                         | 200 `{ learnings: LearningView[] }`                                                     |
| `POST /api/app/search`                      | `HiveSearchInput`            | 200 `{ hits: SearchHit[] }`                                                             |
| `POST /api/app/ask`                         | `HiveAskInput`               | 200 `AskResult`                                                                         |
| `GET /api/app/conflicts?cellId=<id>` | none | 200 `{ decisions }`, scoped to this cell and visible pairs; missing cellId returns 400 |
| `POST /api/app/conflicts` | `{ id, action: "reverse" \| "reason", reason? }` | 200 `{ id, decision?, reason, record }`; omitted or blank reversal reason defaults to "Admin requested reversal" |
| `POST /api/app/feedback`                    | `HiveFeedbackInput`          | 200 `FeedbackResult`                                                                    |
| `GET /api/app/members`                      | none                         | 200 `{ members: MemberView[], overview: TeamOverview }`                                 |
| `POST /api/app/keys`                        | `{ label? }`                 | 201 `{ apiKey, prefix }`                                                                |

## LLM module (`apps/web/src/server/llm/index.ts`)

```ts
embedText(text: string): Promise<number[] | null>                       // null when the key is absent or the call fails
synthesizeAnswer(question: string, hits: SearchHit[]): Promise<AskResult> // never throws; falls back to extractiveAnswer
extractiveAnswer(hits: SearchHit[]): AskResult
suggestTags(learning: Pick<LearningView, "title" | "body" | "kind" | "repo">): Promise<string[]> // [] on any failure
```

## Seed

`apps/web/scripts/seed-data.json` holds the demo learnings; each has an `author` name. `pnpm --filter web seed -- --url <base url> --key <api key of an existing member> --invite <invite code>` joins the other authors through `POST /api/app/join`, then pushes every learning through `tools/call hive_push` on `/api/mcp` with the right author's key. The script prints the ids. It never prints a key.

## Round 3: email identity and access (historical contract)

Email verification precedes public team creation and joins. POST `/api/app/teams` and `/api/app/join` return 202 with an opaque verification token. POST `/api/app/email` accepts `intent: domain` for domain joins or `intent: account` with a session to verify a legacy member. PUT `/api/app/email` consumes the token and six-digit code. Successful creation or join returns the key once and starts the existing hashed, httpOnly session. An account verification binds the email without issuing a new key.

Members have nullable email for existing identities, a unique lowercase email index, email_verified, role (member/admin), and removed_at. The earliest existing member and each new creator are admins. New public joins require verified email. Domain joins use exact allowed-domain equality and reject public providers and their subdomains. Only an admin's own verified domain can be allowed; each domain belongs to one hive.

Invite_code now contains SHA-256 only. Invite_expires_at defaults to seven days. Legacy invites are hashed during migration; members retain keys and sessions. A raw invite is returned only when created or rotated. Neither overview nor members reads reveal it. Pending email payloads contain only an invite hash.

Verification codes use salted scrypt (N=32768, r=8, p=3), expire after 15 minutes, and accept at most five attempts. An opaque 256-bit verification token is hashed too. PostgreSQL locks serialize attempts, and consumed or undelivered codes cannot succeed. Resend delivery uses idempotency headers and hides provider error bodies. Sending allows five per email and 20 per IP per hour, with a 30-second resend pause. Verification allows 30 per token and 60 per IP per minute. Missing RESEND_API_KEY or EMAIL_FROM returns 503 and disables the feature. RESEND_EMAIL_DOMAIN identifies the sender domain for deployment checks.

GET/PATCH `/api/app/account` reads and changes the current member's name. Keys include labels, prefix, created_at, last_used_at, revoked_at. POST `/api/app/admin` rotates invites, allows the verified domain, removes a member, revokes a key, deletes a cell or marks it outdated. Members can revoke their own keys; all other actions recheck admin membership. Every team mutation filters by the authenticated team. Removing a member revokes keys and sessions but preserves attribution. An admin's outdated mark survives later votes. Account exposes name changes. Connect exposes personal keys. Team exposes member and team access controls. Install commands stay unchanged.

Migrations 0004_email_access.sql and 0005_moderation.sql run in the migration runner's transaction, with lock and statement timeouts. Rollback files live under drizzle/rollback and never run in the forward scan. Rollback cannot recover a hashed invite; it issues replacement codes. Production migrations run from the committed main tip before the code deploys.

## Round 3: friction and insights

The learning-kind enum includes learning, gotcha, decision, snippet, incident, insight and friction. hive_push accepts area (repo/tool/process/docs/environment/people), cost (optional nonnegative integer minutes, maximum 1,000,000 per report), blocked (historically boolean, default false; now nullable) and workaround (optional text, at most 4000 characters). The workaround is redacted before storage. hive_search and hive_recent accept an optional kind hard filter. GET /api/app/feed accepts kind too.

Learnings store the friction fields. On a same-kind duplicate, cost accumulates measured values, blocked is combined with OR, and a new workaround can replace the old one. Same normalized title and repo merge even when embeddings differ. Different kinds do not merge. Each learning_pushes event stores its own area, cost and blocked state. Friction deduplication uses title equality so distinct reports keep distinct citations. The weekly summary uses event timestamps in the last seven days, not lifetime cell totals. Null cost contributes to an explicit unmeasured count, never fabricated minutes. The summary joins both learning id and authenticated team id. It groups recurring titles after whitespace and case normalization, including citations to each cell, and ranks top areas by minutes then report count.

GET /api/app/friction returns count, measured minutes, unmeasured count, blocked count, area groups, recurring titles and cited cells. An optional repo is a hard filter. hive_ask recognizes friction asks and returns a deterministic aggregate with citations and a measurement gap. The comb has a kind filter, distinct integer-scale badges for friction and insight, and a polling Friction panel. The instruction block and Stop hook ask what slowed you down, how long, and whether there was a workaround. The connection commands stay unchanged.

0006_friction.sql extends the enum and both tables. 0007_friction_events.sql preserves blocked state on each report. Its rollback maps the new kinds to learning before narrowing the enum. Six seed cells record the 12 October build facts requested for this round, with unknown costs omitted. No names of customers or secrets are seeded.

## Round 3: Jev decisions

One server module, src/server/classify.ts, owns typed questions and the pure decide() policy. The JavaScript SDK is pinned to 0.6.0. Every request uses jev-1.13.0, timeout 500 ms, retry.maxRetries 0 and SDK body logging off. Five independent push questions run in one POST /v1/systemone: kind (Choice over seven kinds), worthSharing (Noul), sensitive (Noul), repoArea (Choice over frontend/backend/database/testing/deployment/tooling/documentation/process/none), and severity (Score from no friction to destructive impact). Known secret shapes are redacted before this request. Sensitive probability at least 0.8 refuses the push. A caller's kind always wins; otherwise Choice confidence at least 0.6 selects the kind. A repository-topic tag needs confidence at least 0.6; none adds no tag. Sharing value is advisory for intentional pushes, not silent data loss. Severity is consumed only for friction. Raw probabilities remain available in classification.

The Node Stop script reads up to 100,000 trailing transcript characters and extracts at most 6000 characters of assistant text. Local changes, errors or explicit observations plus at least 20 characters of text form the cheap pre-gate. A quiet session has no network or model call. An authenticated POST /api/app/capture runs one sharing Noul. At least 0.65 asks the agent to capture; lower skips. The route rate-limits each member to 30 requests per minute. The script reads and refreshes ~/.hive/oauth.json first, then accepts HIVE_KEY or a registered headless key as a fallback, asks once per session, and preserves headless final answers. A provider or network outage uses the local activity signal. Missing/unsupported transcripts skip capture. Installed scripts need to be updated.

The ask Noul receives the question and bounded retrieved cell evidence, with outdated state. Probability at least 0.7 permits synthesis. Lower probabilities return no citations, low confidence and an explicit evidence gap. Empty retrieval and deterministic friction summaries need no model. On a TypeSafe outage, current evidence needs vector similarity at least 0.55 or at least 75% direct lexical coverage when vectors are absent. This fallback is conservative, not proof of answerability.

Migration 0008_classification.sql adds JSONB evidence to learnings, learning_pushes and ask_log. A learning holds its latest push classification; push events preserve earlier evidence. Ask logs preserve relevance evidence. Decision logs contain model, latency, policy output and provider status, never raw text or credentials. No-network evals cover thresholds, caller precedence, refusals, empty/quiet gates, outages and malformed responses. TYPESAFE_LIVE_TEST=1 opts into a real provider smoke test. The thresholds need a larger labeled team eval before broad rollout.


## Current learning lifecycle and knowledge tree

The normative storage decision is [learnings-backend.md](learnings-backend.md). Migrations 0009 and 0010 add the following contracts without dropping old cells or identity data.

- `learnings.lifecycle`: fresh, confirmed, superseded, outdated, retracted. `superseded_by` is a same-team foreign key. `verify_after` and `revision` are persisted. Existing outdated votes/admin marks backfill outdated; positive feedback/repeat pushes backfill confirmed.
- `learning_versions`: immutable content snapshots plus a field-level before/after diff. Triggers cover content changes from all writers, ignore counters/embedding-only writes and attribute explicit edits to the request actor. The first migration backfills version 1 for every existing cell. Author/admin PATCH uses `revision` as an optimistic concurrency check. Superseded cells cannot be edited; edit the successor.
- `learning_supersessions`: same-team endpoints, their compared revisions, relation, confidence, candidate/accepted/rejected state and decision reason. Acceptance takes the team lock, rechecks both endpoint versions, prevents cycles and permits only one accepted successor per older cell. Stale comparisons return 409. Automatic decisions use the typed Jev and Sonnet policy below. Old vote records remain historical data.
- Verification defaults: environment 14 days, snippet/incident 30, gotcha/friction 45, learning/insight 90, decision 180. Version/dependency/URL signals cap this at 30 days. An explicit `verify_after` overrides the default. Expiry marks uncertainty; it does not erase a cell.
- `learning_evidence`: one immutable redacted payload per push, including optional `evidence.session_excerpt` and `evidence.diff` (50,000 characters each). The same transaction stores its pending JSON, hash and target key. A successful private Blob upload clears the temporary payload and records the object reference. Existing pre-0010 raw inputs have no evidence archive.
- `knowledge_state`: per-team desired/published revisions, path-to-object manifest and next verification deadline. Row changes mark the tree dirty. `after()` flushes evidence and regenerates the tree, uploading only changed files. Publication uses compare-and-swap on the desired revision. Readers retry dirty publication; a failed upload leaves the last manifest and pending work intact. An explicit rebuild force-writes all files and drains all evidence batches.

The tree contains `repos/<owner>/<repo>/<area>/<slug>-<id>.md`, `notes/<area>/...` for missing repos, `topics/<tag>.md`, `people/<member>.md`, `friction/<area>.md` and `INDEX.md`. Canonical files contain JSON-valued YAML metadata, Markdown content, lifecycle and replacement IDs. Index links are relative, so they work after extraction. History stays in the tree and is labelled; only the root's current section excludes it. Topic tags combine normalized caller tags, the existing Jev repository topic and a bounded list of tool/service entities accepted by Jev at probability >= 0.8. This is not a general entity graph.

MCP additions:

| Tool or input | Contract |
| --- | --- |
| `hive_push.supersedes` | Existing same-team cell ID; explicit acceptance of a new replacement |
| `hive_push.verify_after` | ISO datetime for a future verification check; past dates immediately show a warning |
| `hive_push.evidence` | Optional redacted session excerpt and diff |
| `hive_search.include_history` | False by default |
| `hive_browse({path?})` | Immediate children of a relative directory; root is the empty path |
| `hive_read({path})` | A generated Markdown file and its published revision |
| `hive_snapshot({})` | Tar.gz URL, expiry, file count and revision |

Tree reads never accept object keys. Paths reject absolute paths, dot traversal, backslashes and control characters. Every lookup uses the authenticated team manifest. Objects live in private Vercel Blob under team-prefixed, content-addressed keys. Snapshots use regular read-only tar entries, validate file digests and cap source bytes at 50 MB. Generation has an explicit 10,000-cell limit. A random 256-bit snapshot token is stored only as a hash, bound to its team/member and checked for expiry and active membership on every download. The URL lasts 15 minutes and grants access to its one archive; it is a bearer credential and must not be logged or shared publicly.

Cell details remain at `/app/cells/[id]`. Citations display truncated titles, with IDs only in tooltips or cell details. Cells show lifecycle, verification dates, a readable successor link and version diffs. `POST /api/app/conflicts` accepts an admin reversal with an optional reason, or an audit-reason edit by the reversing admin. GET reads visible automatic changes only when a cellId is supplied. The former global list and filters are removed. `GET /api/app/learnings/[id]/versions` reads history; `PATCH /api/app/learnings/[id]` accepts revision-checked edits. `GET /api/app/knowledge?path=...&read=true` reads a file and POST prepares an archive for Team. All app APIs authenticate before querying. `GET /api/knowledge/snapshot?token=...` authenticates by its short-lived capability instead of cookies. MCP browse, read and snapshot tools remain.

Operational limits: Blob garbage collection, a scheduled queue worker, streaming large hives, arbitrary free-form entity extraction and a visual content editor are not implemented. Run `pnpm --filter web knowledge:rebuild` for recovery. The SQL rollback files refuse to discard evidence/history already created by the feature; read them before considering a rollback. Normal development and production use the handwritten migration runner, never schema push.

## Analytics

The [analytics contract](analytics.md) defines the versioned append-only event envelope, allowlisted metadata, fixed reasons, traffic classification, trusted boundaries and five private SQL reports. The analytics page and all browser page, cell and error beacons are removed. Server events and authenticated installer and hook reports remain. Early-access signups stay in `early_access`. Round C changes no tables or migrations.

## Better Auth web and MCP access

This section replaces the historical public create/join/email-code and key sign-in routes. POST `/api/app/teams` and `/api/app/join` return 410. `/api/app/email` is only a scoped legacy account-email upgrade. Normal accounts use `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/email-otp/verify-email`, `/api/auth/email-otp/request-password-reset` and `/api/auth/email-otp/reset-password`. Email codes are hashed, last 15 minutes and allow five attempts. Shared database rate limits protect auth and email sending. Passwords use Better Auth's scrypt. First-password reset creates a credential account for the same existing member. Password reset revokes web sessions.

The user model maps to the stable member identity. Hive memberships own hive, role and removal state. Better Auth owns image and updated_at; hive_registration stores a validated pending intent and only an invite hash. Enrollment locks the identity, requires verified human email, and validates the live invite or allowed work domain before inserting a membership. It preserves other memberships and removal tombstones. Humans create organisations as admins; agents follow verified owners as members. Public providers cannot domain-join. Google and Slack link by matching verified human email; agent owner contact is not human login proof. A provisional human claims the same identity with a single-use signed welcome link valid for 24 hours. Claiming verifies the email and creates the session in one transaction; account collisions fail closed.

The session model maps to web_sessions, with new token, updated_at, ip_address and user_agent columns. New sessions also retain a token_hash and the resolved team when one exists. Legacy hash-only rows and member IDs stay intact. A member with no email uses a live legacy session to verify an address on the account page. Keys remain valid for headless access. Disabled identities cannot obtain sessions. Removed memberships cannot authorise that organisation; personal access and other memberships survive.

0011_better_auth.sql adds the mapped model fields, credential accounts, verification and database rate limits. 0012_mcp_oauth.sql adds signing keys, clients, resources, client-resource links, access/refresh tokens, consents and client assertions. Both migrations have IF NOT EXISTS guards and local lock/statement timeouts. Rollbacks refuse populated accounts/grants; they are not applied to production as verification.

The authorization issuer is Better Auth's canonical base URL including /api/auth. Well-known resource and issuer aliases and /oauth2/* reach auth.handler. The protected resource comes from publicUrl(). Token grants are authorization_code and refresh_token; public clients require S256 PKCE. The hive scope keeps a credential in one hive. The additional hive:person scope requires explicit consent to personal access and active organisation memberships, including organisations joined in future. It resolves the personal hive independently of browser selection. Existing keys never gain this scope. New JWTs carry a credential version and cutover epoch; the bearer gate rejects old grants even though their signatures remain valid. Migration 0029 retires the selected member columns while keeping the OAuth epoch at zero and preserving current grants. A separate operator command reports grants per person in dry-run mode. Its apply mode requires the approved report digest, revokes existing OAuth grants, clears remembered consent and advances the epoch once. Schema deployment does not force a reconnect. It preserves keys, web sessions and audience-scoped snapshot links. offline_access must be requested to get refresh tokens. Login and post-login flows preserve the signed oauth_query through email, social sign-in, enrollment and consent. Tampered or expired consent queries do not render a permission request. Dynamic native registrations that omit application_type receive a validated native hint; explicit client choices remain intact.

The default installer asks for email, then writes the same agent bearer for MCP and hooks without a browser. Harness markers choose only the current client. Claude Code uses an Authorization header; Codex uses a private header helper and static header fallback. Executor uses a local bearer proxy. Human OAuth remains available through gohive login, with its detached listener and /signed-in landing. Missing MCP tools never trigger installation during unrelated work.

The install page offers Claude Code, Codex and Executor tabs. Executor uses the remote MCP URL and OAuth. Dynamic registration accepts hosted HTTPS redirect URIs as well as native loopback clients.

## Automatic conflict decisions, 13 October 2026

Automatic decisions remain in `conflict_decisions`. MCP and Slack retain admin reversal, and `POST /api/app/conflicts` retains the web mutation contract. The former Decisions page redirects to Hive. The affected cell replaces the list page. GET requires cellId and returns only visible changes touching that cell; it does not restore global filters.

A push detects a candidate when a similar same-team, same-repo current cell has a Jev update or contradiction signal at confidence 0.70 or above. Before the write transaction, one Jev request asks Choices about scope, replacement, compatibility, specificity and stronger evidence; Scores grade each cell's evidence. An action Choice covers the fixed outcomes. One Sonnet call receives both cells, redacted evidence, dates, authors, vote counts and Jev judgments. Sonnet's structured schema has `decision`, a one-line `reason` of at most 500 characters, and finite `confidence` between 0 and 1. State is untrusted data.

Sonnet decides at confidence >= 0.80. Otherwise Jev's action Choice decides at confidence >= 0.85. Otherwise the attempt is `undecided` with a reason. Initial floors need evaluation on labelled team data. Jev has a three-second timeout and Sonnet a fifteen-second timeout, with no SDK retries. Up to four candidate pairs run concurrently. No model call holds the team database lock.

| Decision | Applied state |
| --- | --- |
| `supersede` | Accept the existing supersession edge and retire the older cell. Preserve cycle and single-successor checks. |
| `keep_both` | Keep both cells current and retain their related edge with the decision. |
| `keep_old` | Move the newer cell's pushes and evidence into the older cell, increment its push count, and retract the weaker duplicate. Return the older id as a merged push. |
| `mark_outdated` | Mark both cells outdated with an immediate verification deadline. |
| `retract_new` | Retract the newer cell, preserving authorized history. |
| `undecided` | Keep both cells current and the edge candidate. Retry up to three older related candidates on the next related push. |

`conflict_decisions` stores each attempt with team, edge, action, reason, confidence, fixed model, all Jev answers, latency, newer pusher, before/after lifecycle and observation state, moved push ids and timestamp. Earlier edges are backfilled as legacy log entries; they cannot be reversed without a recorded before state. Models' unavailable evidence is labelled unavailable, not invented. Pending evidence is read from rows; uploaded evidence is read from authorized private Blob keys with a digest check.

The application rechecks revisions before applying decisions. Admin reversal rejects subsequent content, votes or push-count changes, restores the prior lifecycle and moved pushes, and appends a `reversed` entry linked to the original. The cell's Reverse button acts immediately with the audit reason "Admin requested reversal" and refreshes the cell. The line shows "Reversed just now" and offers Add a note to the reversing admin. The note edits the new reversal record. The web does not offer a second reversal; MCP and Slack keep their guarded undo contract. Reversing the new decision ID reapplies the saved decision only while cells remain unchanged. `hive_reverse_decision({decision_id})` exposes the same guarded operation through MCP and Slack. Slack uses the shared decisiveness check and a replay-safe thread action receipt. It does not delete the original decision or ask members to vote. Related pushes retry undecided candidates with current evidence. There is no daily retry job.

Every applied attempt and reversal emits `conflict.decided` after commit using the private analytics writer. Its allowlisted properties contain action, confidence, fixed model and fixed-key Jev distributions, plus envelope latency. No bodies, titles, reasons, authors or repo paths enter events. Migration 0014 adds the log after analytics migration 0013; SQL uses local lock/statement timeouts and rollback refuses populated history.


## Capture rules

The [capture rule contract](capture-rules.md) defines member and admin-owned team rules, typed configurations, matcher order and privacy behaviour. Core exports the shared deterministic matcher. Every ingress enforces the caller's effective rules before embedding or storage. Content classification runs only when a content rule needs it. Dropped pushes return `{ dropped: true, rule: <kind> }`.

The Team page shows three default exclusions, on from team creation: credentials, personal data and customer data. One sentence field saves a complete instruction immediately and shows a highlighted result with Undo. The list uses plain words with enable and delete controls. `CaptureRules` defaults to team mode, with admin controls; personal mode shows the caller's exclusions for Account. The capture settings route redirects to Team until its removal. The structured editor, manual existing-cell batches and history reversal routes do not exist. `GET /api/app/capture-rules/effective` requires a team-scoped bearer token. Other capture routes use the web session. Jev checks instruction clarity, specificity and scope with a 500 ms timeout; the schema model supplies fallback judgement. Sentence-based exclusions still update existing memories automatically, with caller-bound Undo for one hour and guarded internal batches. Missing details produce one question. Flagged cells stay owner-only until the owner explicitly confirms sharing; shared materialisations exclude them. Migration 0024 backfills the three defaults idempotently.
## Slack connection, conversation and knowledge

`/app/settings/slack` is an admin-only connection, channel selection and decision log page. Bot installation uses Slack OAuth v2 independently of Sign in with Slack. One Slack workspace connects to one Hive team. Tokens use AES-256-GCM with team/workspace associated data. OAuth state is single-use, bound to the admin and a short-lived browser cookie. Verified Slack email resolves an active same-team member; unmatched authors display as Slack teammate and cannot call member tools.

Signature-verified HTTP events are operationally deduplicated and queued using job references. Jobs store only necessary fields with redacted text; response URLs, credentials, files and arbitrary Slack metadata are discarded. Vercel Queue callbacks execute bounded work and retry rate limits. Channel generations and row locks prevent stale backfills from writing after stop or purge. Raw messages require active installation, current bot membership and an enabled or paused selected channel on every retrieval. No DM enters `slack_messages`. Private channel selection shares that channel's indexed knowledge with the Hive team; public Slack replies exclude private Slack evidence.

`hive_search` and `hive_ask` combine cell and Slack candidates using the existing hybrid ranking, weighting raw Slack candidates by 0.7. Slack results use `source: slack`, `slk_` IDs and original permalinks. MCP citations retain original Slack permalinks. Slack replies use short numbered markers and a single Sources block linked to dashboard cells, where raw Slack items expose their original message links. Ask history persists per team/channel/thread; DMs restrict it to the asking Slack actor. Saved Slack learnings use the existing Jev classifier and lifecycle. Raw indexed messages are read-only dashboard evidence.

Mentions and DMs make one `claude-sonnet-5-5` routing call with tools, execute a single selected tool, and post its returned text/blocks directly. Grounded `hive_ask` retains its own synthesis. The plain array `slackTools` at `apps/web/src/slack/tools/index.ts` holds entries with `name`, `description`, `input_schema` (JSON schema), `handler(ctx,args)` and optional `handleAction(ctx,action,value)`. Context is `{teamId,memberId,isAdmin,channelId,threadTs}` and result is `{text,blocks?,silent?}`. Core tools are `hive_ask`, `hive_recent`, `hive_save` and `stay_silent`. Digest and capture rule rounds append their tools here. Each handler validates input and checks current membership; admin writes must use `requireAdmin(await toolActor(ctx))`. The model cannot grant permissions.

Admins can tag Hive to set or stop a digest schedule. Clear instructions and fully specified admin suggestions act immediately after a 500 ms Jev judgement; the schema model supplies the same judgement if Jev is unavailable. Missing time or an ambiguous channel or target asks one question. The reply states the schedule and next run. Reply `undo` or `cancel that` in the same thread within one hour to reverse your change. Undo cannot replace a later configuration edit. Members can list schedules.

Jev is advisory: an explicit request proceeds; an unsolicited answer requires a closely matching confirmed non-expired cell and no human-conversation, already-answered or unfinished-message veto. Provider failure stays silent. Database locks reserve at most one unsolicited reply per thread and two per channel per hour. Every gate outcome is visible to admins. Delivery states distinguish reserved, sending, sent and uncertain; ambiguous network delivery is not blindly repeated. `slack.event_received` and `slack.reply_decided` use the shared append-only analytics envelope with team, channel, fixed event kind, decision and latency, never text.

Migration `0015_slack.sql` follows applied analytics 0013 and conflicts 0014. Its rollback refuses populated Slack knowledge. Backfills read 15 messages per page and continue after 60 seconds. Message shortcuts/permalink saves currently capture up to 15 thread messages and state truncation. Slash command payloads do not identify a selected thread, so `/hive save` requires a permalink or the message shortcut. Digest scheduling and capture rules are sibling additions, not stubbed core mutations.

Vercel topics are partitioned by deployment. Every 15 minutes, `/api/cron/slack-maintenance` refreshes channels and republishes up to 100 pending event, command, action and backfill references per active workspace to the current deployment. The cron uses a current human team admin and skips teams without one. Database leases and message receipts still prevent duplicate delivery. This also recovers an outbox write whose queue publish failed. Failed job diagnostics contain only kind, error class and HTTP status, never payload text or credentials.

### Team settings

Team has four sections: Members (`#members`), Slack (`#slack`), What Hive keeps (`#keeps`) and Export (`#export`). Members see the sections read-only. Slack keeps Connect, Disconnect, channel selection, Stop and Purge with their consequences. Channels refresh and pending work retries automatically. Ask @Hive in a channel for a weekly update. The decision log appears only at `/app/team?debug#slack`. Account mounts personal exclusions under What your agents keep; the team exclusions still apply.

## Scheduled Slack digests

Admins can tag Hive to set or stop a digest schedule. Clear instructions and fully specified admin suggestions act immediately after a 500 ms Jev judgement; the schema model supplies the same judgement if Jev is unavailable. Missing time or an ambiguous channel or target asks one question. The reply states the schedule and next run. Reply `undo` or `cancel that` in the same thread within one hour to reverse your change. Undo cannot replace a later configuration edit. Members can list schedules.

A schedule stores cadence (daily, weekdays, weekly, fortnightly or monthly), chosen day, local time, IANA timezone, enabled state, section flags and skip-empty preference. Weekly and fortnightly schedules use a chosen weekday. Fortnightly runs anchor to the creation week. Monthly days beyond the month's length use its last day. A missing spring clock time shifts forward by the gap. A repeated autumn time uses its first occurrence once. Ticks run every 15 minutes, so delivery can follow the chosen time by up to 15 minutes. Missed slots coalesce into one update after recovery.

`slack_digest_schedules` holds the team, channel, settings, creator, next due slot, last delivered time and timestamp watermark. First coverage starts seven days before creation. `slack_digest_posts` records each slot, status, section counts, Slack timestamp, optional permalink and a safe error. A transaction locks the schedule and reserves a unique slot before a send. A partial unique index permits one running send per schedule. Manual posts share that reservation and move the next automatic slot forward. Edits and disables wait until the running attempt finishes.

`slack_digest_receipts` records covered cell revisions, friction observation IDs and conflict decision IDs with the successful post. It covers unselected sections too, so enabling a section later does not repeat an older successful period. Gathering uses the initial coverage boundary plus these receipts, so a late transaction cannot disappear behind a moving timestamp watermark. Successful posts atomically save receipts, counts and the watermark. Empty skipped updates consume their slot and leave content coverage unchanged. Failed attempts retain the content for a later update. A lost send response is marked uncertain and is not retried in the same slot. A running attempt older than ten minutes becomes uncertain on the next attempt. Admins must check the channel after an uncertain send; the next scheduled attempt retains uncovered content. A successful send remains successful when permalink lookup fails; the Slack timestamp is still recorded.

Flagged cells are excluded from digests and previews for every reader, including their owners. Conflict decisions are omitted when either source cell is flagged. Replacement links hide a flagged successor. The reader checks for the flag column without caching during rollout and uses an exact false predicate once migration 0017 exists.

The pure composer shows new or changed current cells, brief replacement notices, insights, friction grouped by area and recorded automatic conflict decisions. It counts repeated friction pushes separately, sums only measured minutes, shows unknown costs and blocked counts, and links workarounds to their cells. Each section shows up to five items or friction areas. Longer sections end with a link to the hive. User text is escaped so it cannot create Slack mentions; verified Slack actor links supply contributor mentions. Public destinations omit Slack-sourced cells under the Slack core's conservative audience rule. The payload stays below 50 blocks and each section below 3,000 characters. Preview uses the same composer and delivery receipts.

`GET /api/cron/slack-digests` requires the exact bearer `CRON_SECRET` and refuses requests when the secret is absent. It processes at most twenty due schedules and stops before the function deadline; remaining work stays due. The optional team query is available only behind the same secret for operational checks. Production deploys register `*/15 * * * *` in `apps/web/vercel.json`; previews have the secret but no automatic cron execution.

Admins can tag Hive to set or stop a digest schedule. Clear instructions and fully specified admin suggestions act immediately after a 500 ms Jev judgement; the schema model supplies the same judgement if Jev is unavailable. Missing time or an ambiguous channel or target asks one question. The reply states the schedule and next run. Reply `undo` or `cancel that` in the same thread within one hour to reverse your change. Undo cannot replace a later configuration edit. Members can list schedules.

Migration 0019 adds durable instruction history and a configuration revision for safe undo. Its rollback refuses to remove populated instruction history. Keep delivery history during an application rollback.
### Slack reply presentation

Every message reply uses its incoming `thread_ts`, or its own `ts` for a top-level mention/DM. The reply client requires a parent timestamp and explicitly sets `reply_broadcast=false`. Slash payloads without a message timestamp create a short question root; the answer is posted only in that root's thread. A supplied slash parent is reused. The root is persisted before tool work so handler retries can reuse it. Signed repeated slash deliveries receive at most one ephemeral “The hive is looking.” acknowledgement.

The answer has plain prose and numbered citation markers, with at most one marker per sentence. Sources deduplicate cell IDs and a raw Slack item plus a saved cell from the same original permalink. Titles stop at a word boundary within 80 characters; each source links to its dashboard cell and shows its recorded date. Standalone “As of” lines are removed in Slack. High confidence and empty gaps are omitted. Medium/low confidence gets one short sentence, and a gap appears only when present. Replacement notes are limited to cells actually cited by the answer; identical-title replacement notes are dropped.

### Slack admin instructions and undo

Mentioning Hive or sending it a DM can request an admin change in plain language. A single `claude-sonnet-5-5` routing call supplies typed inputs to the plain `slackTools` array in `apps/web/src/slack/tools/index.ts`; schedule and capture tools do not run another interpretation call. `SlackToolContext` includes the verified member, team, channel and thread plus server-supplied original `instructionText` and `messageTs`. Tools call exported `decideDecisiveness(text, ctx)`: active admin membership is a hard condition, and Jev must judge the original message a clear instruction, sufficiently specific and allowed. Questions, musings, missing details and unavailable judgments cause no change.

Tools act without confirmation buttons. `runReversibleAction(ctx, toolName, change(tx))` stores the mutation and inverse in one database transaction and returns one line stating the resulting change. The `undo_last_action` tool reverses only the latest reversible action in that team/channel/thread, only for its author while still an admin, within one hour, and only if the resource has not changed later. A plain “undo” in that thread invokes the same route. Replayed messages return the original receipt instead of making a second change. Creating a schedule is undone by removing it from the schedule list; pausing one restores its previous enabled state; creating a capture rule is undone by removing it. Already-sent updates and already-processed captures remain. `/hive save` and bee reactions retain their existing behavior. The signed interactivity route still supports `tool:<name>:<action>` for future tools, but no shipped tool needs a confirm action. Migration `0018_slack_actions.sql` adds receipts; its rollback refuses to remove live undo records.

The shared decisiveness context may include a server-selected `actionType` (`digest`, `digest_pause`, `capture`, `undo`). Jev asks the specificity question for that action only. The intent, specificity and allowed probability floors are 0.80, 0.70 and 0.85 respectively; database membership always overrides model claims. Six live judgments cover a complete schedule, an exact capture keyword, thread undo, a musing, an incomplete schedule and an informational question. They are regression fixtures, not a broad intent benchmark.

A digest schedule set from a complete request gets a thumbs-up reaction when its next run is within two days and no details were defaulted. Otherwise Hive states the schedule and first run. Missing details get one question. Listing schedules reports their cadence, zone and next run in human terms.

Human dates, clocks and recency share `packages/core/src/human-time.ts`. `slackToolReply(text, ctx)` is exported from the registry, formats timestamps in the speaker’s zone, preserves link targets and literal code, and removes legacy undo hints. `runReversibleAction` and every routed tool result use it. Mutation replies state only the fact; undo remains an internal tool and a plain thread command.

### Reaction outcomes and tentative instructions

The registry includes `react({emoji})` alongside `stay_silent`. Emoji names are `+1` for done or agreed, `eyes` for noted or looking, and `white_check_mark` for saved. Tools may return `{react: "white_check_mark"}` with optional internal `text`; the shared handler executes a real reaction on the triggering message and posts no text. `reactToSlack(ctx, emoji)` in `apps/web/src/slack/tools/react.ts` uses the team's decrypted bot, treats `already_reacted` as idempotent success, and emits `slack.reaction_added` with team/channel, latency and a stable key, never message text. Thread history may retain the action fact for follow-ups, while the dashboard records `react_only`.

An admin's complete “Maybe we should…” instruction acts immediately and reacts thumbs up. A hedge with one missing detail asks one question; a vague musing without actionable content uses eyes or silence. Plain confirmations such as “Done” or “No change made” become reactions. Text is reserved for new information: an answer, a question, a count or a conflict. `runReversibleAction` defaults to thumbs up and stores that outcome with the receipt; a callback may set `react: false` for genuinely new information or choose another emoji. Successful undo reacts white check mark; expired, forbidden or conflicting undo returns the reason. No confirmation buttons or undo hints are needed.

### Active Slack threads and undo

Message events without an @mention route through the same tool handler when their thread has Hive history or an action receipt. The model receives metadata for the latest reversible action. Explicit `undo`, `cancel that` and `revert` prefer `undo_last_action` even if the model suggests another tool or produces a question about setting the action again. Human conversation can still select silence.

`latestThreadAction(ctx)` and `undoThreadAction(ctx)` in `apps/web/src/slack/tools/undo.ts` select across shared action receipts and digest instructions, scoped to the exact team, channel and thread. Selection includes expired and already-undone receipts; it never falls back to an older action. The original actor, current permissions, one-hour window and resource revision still guard reversal. Successful undo reacts `white_check_mark` and posts nothing. Errors state the reason without control hints. Migration 0021 permits durable white-check undo receipts and backfills digest pointers into the shared action log. New digest mutations store their inverse pointer atomically with the schedule change. Successful undo removes a newly created schedule while preserving its post history.

## Observation capture and outcome feedback, 13 October 2026

This is the current capture and feedback contract. It replaces the historical title/body requirement and the earlier instructions to calculate metadata or search for a replacement ID before capture.

`hive_push({observation, evidence?, context?})` accepts one fact in the agent's words. Evidence is a string or an object with `session_excerpt`, `diff` and `command_output`. Each evidence field is bounded at 50,000 characters. Context accepts repo, remote, cwd, home, branch, agent, sessionType, sessionRef and up to 20 paths. The old title/body form remains accepted. Title, body, kind, tags, area, cost, blocked, workaround, confidence, source, flat context fields, supersedes and verify_after are optional overrides. Supplied fields win over inference; flat context overrides the nested envelope. Explicit tags, including an empty array, suppress inferred tagging.

Capture rules inspect the observation, evidence and full runtime envelope first. Drop exits before classification, embedding or storage. Redaction removes affected content and clears context, evidence and metadata sidecars as it does for the existing capture path. Secret redaction and the sensitive-data classifier run before the title model. Held captures retain owner-only visibility. Neither a raw envelope nor raw evidence goes to the title model.

The existing Jev push classifier derives kind and repository topic tags. The relation classifier selects supported service tags and compares nearby cells. Friction area maps the classifier's supported repository topic to tool, docs, process, environment or repo. The LLM module makes one Haiku call for a short title and evidence-cited friction details when needed. An unavailable model falls back to the first sentence as title and unknown friction fields. Blocked is nullable: true, false or unknown. Workaround needs a quoted evidence basis. Cost remains null unless an exact evidence quote records measured minutes lost. Runtime, session duration and estimates are not measured loss. Confidence defaults to the existing 0.7 unless supplied. Repo and agent source derive from context; sessionRef and paths preserve the supplied envelope. Verification horizons and relation/conflict decisions use the existing policies. Explicit supersedes still accepts the replacement atomically.

An observation's normalized content, repo and session identify a retry for the same member. A team-locked, unique push key returns the existing cell without another push count, friction cost or evidence event. Without a sessionRef the content and repo still identify a retry for that member. Different sessions retain observation accounting. Exact observation content can merge despite a generated title changing; legacy explicit title/body pushes retain title-sensitive duplicate semantics.

The response is JSON with the saved cell, `inferred` metadata, relation judgments, accepted supersedes IDs, applied decisions, explicit override names and `correction: {tool: "hive_correct", id, revision}`. A replay adds `replayed: true`. The agent can inspect every decided field.

`hive_correct({id, revision, observation?, retract?, evidence?})` accepts either a corrected observation or `retract: true`. It rechecks author/admin membership, team visibility and revision before work and inside the transaction. A correction creates a new immutable revision of the same cell, generates its title after privacy filtering and preserves redacted evidence. Retraction changes lifecycle with the same version audit. Superseded cells require the current endpoint. A stale handle returns 409.

`hive_outcome({id, outcome, evidence?})` reports the concrete result of using a cell. It does not ask the agent to vote. Privacy rules run before outcome classification or persistence; a dropped result is refused, a redacted or held result records no vote, and held history is owner-only. Jev asks a typed result Choice and an evidence-support Noul, with timeout 500 ms, zero retries and logging off. Pure `decideOutcome` needs both result confidence and evidence support at least 0.80. An unavailable or uncertain judgment uses one Haiku structured call with an exact supporting quote and confidence at least 0.80. No supported result means inconclusive.

| Outcome | Existing vote and standing rule |
| --- | --- |
| useful | up; can confirm the cell |
| contradicted | down; reduces ranking and hides the cell when its evidence receipt is newer than the latest current useful outcome |
| stale | outdated; outdated votes greater than up votes mark the cell outdated |
| inconclusive | audit receipt only; existing votes and lifecycle stay unchanged |

The outcome can cite a check in its own text; separate evidence is optional. Bare approval, viewing, retrieval, unfinished attempts and unsupported claims are inconclusive. Search, recent, getLearning, hive_browse and hive_read never cast feedback.

`feedback` remains keyed by cell, audience team and authenticated member. Two agents or credentials for one member cannot stack independent votes. A newer supported outcome or direct vote replaces that member's contribution. Team scope and active membership are hard checks. The existing lifecycle thresholds remain: terminal superseded/retracted states stay terminal, admin-outdated wins, outdated votes greater than up votes make outdated, positive votes or repeated pushes make confirmed, otherwise fresh.

Every direct vote, outcome and withdrawal creates an actor-bound `feedback_receipts` audit row with text, redacted evidence, judgment, target receipt and before/after standing. `hive_feedback({id, withdraw: true, receipt?})` withdraws that actor's current receipt, or the specified non-affecting receipt. A replaced affecting receipt, reused withdrawal or another actor's receipt cannot remove newer feedback. Withdrawal restores the actor's previous contribution, then recomputes standing with current team votes and admin/terminal guards. Correct a result by reporting a new outcome for the same cell. Inconclusive receipt withdrawal has no lifecycle effect.

The web Useful, Unhelpful and Outdated buttons remain optional direct controls. Show history loads both revisions and outcome receipts from the scoped versions API. It displays the actor, outcome text, classification, evidence, current contribution and withdrawals with human dates. Capture-rule scans include outcome evidence. Redaction clears outcome evidence and judgments and replaces text with a redaction marker without discarding the standing audit.

Migration `0022_capture_contract.sql` relaxes blocked nullability, adds unique capture retry keys and marks correction evidence events so friction counts exclude edits. Existing false values stay false; no past uncertainty is invented. Migration `0023_outcome_feedback.sql` adds the outcome audit and a deferred actor/cell/team-bound reference from current feedback. Both are additive and repeatable. Reviewed rollback scripts refuse new observations or audit history rather than discard them. Apply them through `pnpm --filter web db:migrate` from the landing commit before pushing dependent code.

The Hive skill, Codex instruction block, shared Claude/Executor skill and both Stop hook variants say observe, attach evidence, push. Search before investigating remains. After using a cell, report a known result in one line; merely retrieved cells get no feedback. Installer assets come from the shared skill and hook sources.
