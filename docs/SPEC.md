# Hive MVP spec

Hive is a shared memory for a team's coding agents. Each person adds one remote MCP server to Claude Code or Codex. Agents push learnings to the hive. Agents and people search and ask the hive.

This file is the contract between implementation rounds. When code and spec disagree, fix the code or change the spec in the same commit.

## Rules for every round

- No code comments unless asked. Self-documenting names.
- TypeScript strict. Node 24. pnpm workspace.
- No secrets in the repo. `.env*` is gitignored.
- Every database query that touches team data takes `teamId` from an authenticated `HiveContext`. No function accepts a team id from user input.
- UI copy and docs: short sentences, no em dashes, no customer names.

## Layout

```
apps/web                     Next.js App Router (Vercel root directory)
  drizzle/*.sql              hand-written SQL migrations, applied in file order
  scripts/migrate.ts         migration runner (tsx)
  scripts/seed.ts            pushes demo learnings through the MCP endpoint
  src/app                    routes
  src/mcp/server.ts          registerHiveTools(server, getContext)
  src/server/db/             client.ts, schema.ts (Drizzle, postgres.js driver)
  src/server/auth.ts         API keys, web sessions
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
| `PUBLIC_URL`        | canonical URL in metadata, install snippets and invite links | falls back to the request origin                              |

Local Postgres for development: `postgres://hivemind:hivemind@127.0.0.1:54329/<database>` (Docker container `hivemind-pg`, image `pgvector/pgvector:pg18`, extension `vector` 0.8).

Driver: `postgres` (postgres.js) with `drizzle-orm/postgres-js`, `prepare: false`, small pool (`max: 3`), one client cached on `globalThis`.

## Ids and keys

- Ids are text with a prefix and 12 lowercase base32 characters: `team_`, `mem_`, `key_`, `lrn_`, `psh_`, `ses_`, `ea_`, `ask_`.
- API key format: `hm_` + 32 random bytes as base64url. The database stores `sha256(key)` as hex and a display prefix (first 10 characters). The raw key is shown once.
- Invite code: `hive-` + 10 base32 characters. Stored in plaintext so the Members page can show it. It only allows joining a team.
- Web session: random 32 byte token in the `hm_session` cookie (httpOnly, secure in production, sameSite lax, 30 days). The database stores the sha256 hash.

## Tables

- `teams` (id, name, invite_code unique, created_at)
- `members` (id, team_id, name, created_at, last_seen_at)
- `api_keys` (id, team_id, member_id, key_hash unique, prefix, label, created_at, last_used_at, revoked_at)
- `web_sessions` (id, member_id, team_id, token_hash unique, created_at, expires_at)
- `learnings` (id, team_id, member_id, title, body, kind, tags text[], repo, paths text[], confidence real, source, session_ref, push_count int default 1, up_votes, down_votes, outdated_votes, created_at, updated_at, last_pushed_at)
  - plus `search tsvector` generated from title (weight A), tags (B), body (C); GIN index. Not in the Drizzle schema; raw SQL only.
  - plus `embedding vector(1536)` nullable; HNSW cosine index. Added by a separate migration that may fail when pgvector is absent. Not in the Drizzle schema; raw SQL only. The service detects the column once per process and caches the answer.
  - indexes: (team_id, created_at desc), (team_id, repo)
- `learning_pushes` (id, learning_id, team_id, member_id, source, session_ref, merged boolean, created_at): one row per push, including merged duplicates
- `feedback` (learning_id, member_id, team_id, vote, note, created_at, updated_at; primary key (learning_id, member_id)): one vote per member per learning; the counters on `learnings` are recomputed in the same transaction
- `ask_log` (id, team_id, member_id, question, answer, cited_ids text[], synthesized boolean, created_at)
- `early_access` (id, name, email, company, team_size, source, created_at)

The migration runner keeps a `_migrations` table. It applies the pgvector migration inside its own try/catch and logs a warning when it fails.

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
3. Embed `title + "\n\n" + body` (truncate to 8000 characters) when `OPENAI_API_KEY` exists. The call has a 6 second timeout and two retries. An embedding failure never fails the push.
4. Dedupe inside the same team and the same repo (null equals null): nearest neighbour with cosine similarity >= 0.90, or equal normalized title when there is no embedding. On a duplicate: increment `push_count`, set `last_pushed_at`, union tags and paths, keep the max confidence, keep the existing title, replace the body only when the new body is at least 1.5 times longer. Insert a `learning_pushes` row with `merged = true`. Return `merged: true` and the existing id.
5. Otherwise insert the learning and a `learning_pushes` row.
6. When tags are empty and `ANTHROPIC_API_KEY` exists, schedule `suggestTags` with `after()` from `next/server` and store up to 5 tags. This never delays or fails the push.

### Search

1. Candidate set = the 40 nearest learnings by cosine similarity (when the query embeds and the column exists), kept when the similarity is at least 0.30 or the row is also a text candidate, union the top 40 text candidates. A text candidate matches any query lexeme (`plainto_tsquery` with OR) and covers at least half of the distinct query lexemes; it is ordered by `ts_rank_cd`. When both sets are empty, fall back to a prefix `to_tsquery` on the query words. All inside `team_id = ctx.teamId`. `tags` is a hard filter (array overlap). `repo` is a boost, not a filter.
2. Rank with `rankCandidates` from core (pure, unit tested):
   - `vector` = cosine similarity clamped to 0..1
   - `fts` = rank divided by the max rank in the candidate set
   - `recency` = `exp(-ageDays / 45)` on `last_pushed_at`
   - `votes` = `0.5 + 0.5 * tanh((up - down + 0.5 * (pushCount - 1)) / 3)`
   - `score = 0.55 * vector + 0.25 * fts + 0.10 * recency + 0.10 * votes`. Without a vector signal: `0.70 * fts + 0.15 * recency + 0.15 * votes`.
   - plus 0.08 when the repo matches, times `0.85 + 0.15 * confidence`, times 0.4 when `outdated > up` and `outdated >= 1`.
3. Return the top `limit` hits with signals.

### Ask

1. `searchLearnings` with the question, limit 8.
2. No hits: return a fixed answer that says the hive has nothing on this yet, `synthesized: false`, `confidence: "low"`.
3. Call `claude-sonnet-5-5` with structured output (`client.messages.parse` and `zodOutputFormat`), `output_config.effort: "low"`, `max_tokens: 4000`. The prompt gives each learning as a block with its id, title, kind, repo, tags, author, date, votes and body. The model must answer only from these learnings, cite ids inline as `[lrn_xxx]`, say what is missing in `gaps`, and prefer newer and upvoted learnings when they conflict. Do not pass `temperature`, `thinking: disabled`, a prefill or forced `tool_choice`: this model rejects them.
4. Drop citations whose id is not in the retrieved set. On `stop_reason: "refusal"`, any API error, or a missing key: return the extractive fallback (top 3 hits as a bullet list with ids), `synthesized: false`.
5. Write an `ask_log` row.

### Recent

`since` accepts an ISO datetime or `<n>h` / `<n>d`. Order by `last_pushed_at desc`.

### Feedback

Upsert the member's vote. Recompute the three counters. Unknown id in this team: a not-found error, never another team's row.

## MCP endpoint

`/api/mcp`, stateless Streamable HTTP through `mcp-handler` 2.x. `Authorization: Bearer <api key>` is required. A missing or wrong key returns HTTP 401 with `WWW-Authenticate: Bearer` and a JSON body that says how to get a key. Tool results are a text content block. The text is compact markdown that an agent can read, and it always carries the learning ids. Tool errors return `isError: true` with a one-line cause.

## Web

- `/` landing: pitch, how it works, early-access form (name, email, company, team size). The form writes an `early_access` row and shows a thank-you state.
- `/app/login`: three panels. Create a team (team name, your name). Join a team (invite code, your name). Sign in (paste an API key). Create and join show the API key once, with the install snippets filled in.
- `/app`: the comb, one hexagonal cell per learning (title, repo, whose agent, time, votes, status, push count), polling every 5 seconds; a cell opens the full learning with kind, tags, paths, feedback and a copyable id. Status is outdated when outdated votes outnumber up votes, confirmed when it has up votes or more than one push, otherwise fresh. Search box whose result cards show the score and every ranking signal. "Ask the hive" box that shows the answer with clickable citations, the confidence and the gaps. "Fresh nectar" lists the latest arrivals with the agent that brought them.
- All UI comes from `@hivemind/design-system`. `design/system/readme.md` sets the vocabulary and the voice.
- `/app/members`: members, the invite code with a copy button.
- `/app/install`: snippets with copy buttons. A "Create a new key" button issues a key, shows it once and fills the snippets.
- Web API routes live under `/api/app/*` and authenticate with the session cookie. They call the same service functions as the MCP tools.

## Web HTTP API

All bodies are JSON. Errors are `{ "error": "<one line>" }` with a 4xx or 5xx status. Routes under `/api/app/*` other than `teams`, `join` and `session` need the session cookie and return 401 without it. Every body is validated with the zod schema from core.

| Route                                       | Body                         | Success                                                                                 |
| ------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `POST /api/early-access`                    | `EarlyAccessInput`           | 201 `{ ok: true }`                                                                      |
| `POST /api/app/teams`                       | `{ teamName, memberName }`   | 201 `{ apiKey, inviteCode, team: { id, name }, member: { id, name } }`, sets the cookie |
| `POST /api/app/join`                        | `{ inviteCode, memberName }` | 201 `{ apiKey, team, member }`, sets the cookie. 404 for an unknown code                |
| `POST /api/app/session`                     | `{ apiKey }`                 | 200 `{ team, member }`, sets the cookie. 401 for an unknown key                         |
| `DELETE /api/app/session`                   | none                         | 204, clears the cookie                                                                  |
| `GET /api/app/feed?since=7d&repo=&limit=50` | none                         | 200 `{ learnings: LearningView[] }`                                                     |
| `POST /api/app/search`                      | `HiveSearchInput`            | 200 `{ hits: SearchHit[] }`                                                             |
| `POST /api/app/ask`                         | `HiveAskInput`               | 200 `AskResult`                                                                         |
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

## Round 3: email identity and access

Email verification precedes public team creation and joins. POST `/api/app/teams` and `/api/app/join` return 202 with an opaque verification token. POST `/api/app/email` accepts `intent: domain` for domain joins or `intent: account` with a session to verify a legacy member. PUT `/api/app/email` consumes the token and six-digit code. Successful creation or join returns the key once and starts the existing hashed, httpOnly session. An account verification binds the email without issuing a new key.

Members have nullable email for existing identities, a unique lowercase email index, email_verified, role (member/admin), and removed_at. The earliest existing member and each new creator are admins. New public joins require verified email. Domain joins use exact allowed-domain equality and reject public providers and their subdomains. Only an admin's own verified domain can be allowed; each domain belongs to one hive.

Invite_code now contains SHA-256 only. Invite_expires_at defaults to seven days. Legacy invites are hashed during migration; members retain keys and sessions. A raw invite is returned only when created or rotated. Neither overview nor members reads reveal it. Pending email payloads contain only an invite hash.

Verification codes use salted scrypt (N=32768, r=8, p=3), expire after 15 minutes, and accept at most five attempts. An opaque 256-bit verification token is hashed too. PostgreSQL locks serialize attempts, and consumed or undelivered codes cannot succeed. Resend delivery uses idempotency headers and hides provider error bodies. Sending allows five per email and 20 per IP per hour, with a 30-second resend pause. Verification allows 30 per token and 60 per IP per minute. Missing RESEND_API_KEY or EMAIL_FROM returns 503 and disables the feature. RESEND_EMAIL_DOMAIN identifies the sender domain for deployment checks.

GET/PATCH `/api/app/account` reads and changes the current member's name. Keys include labels, prefix, created_at, last_used_at, revoked_at. POST `/api/app/admin` rotates invites, allows the verified domain, removes a member, revokes a key, deletes a cell or marks it outdated. Members can revoke their own keys; all other actions recheck admin membership. Every team mutation filters by the authenticated team. Removing a member revokes keys and sessions but preserves attribution. An admin's outdated mark survives later votes. The account and members pages expose these actions. Install commands stay unchanged.

Migrations 0004_email_access.sql and 0005_moderation.sql run in the migration runner's transaction, with lock and statement timeouts. Rollback files live under drizzle/rollback and never run in the forward scan. Rollback cannot recover a hashed invite; it issues replacement codes. Production migrations run from the committed main tip before the code deploys.

## Round 3: friction and insights

The learning-kind enum includes learning, gotcha, decision, snippet, incident, insight and friction. hive_push accepts area (repo/tool/process/docs/environment/people), cost (optional nonnegative integer minutes, maximum 1,000,000 per report), blocked (boolean, default false) and workaround (optional text, at most 4000 characters). The workaround is redacted before storage. hive_search and hive_recent accept an optional kind hard filter. GET /api/app/feed accepts kind too.

Learnings store the friction fields. On a same-kind duplicate, cost accumulates measured values, blocked is combined with OR, and a new workaround can replace the old one. Same normalized title and repo merge even when embeddings differ. Different kinds do not merge. Each learning_pushes event stores its own area, cost and blocked state. Friction deduplication uses title equality so distinct reports keep distinct citations. The weekly summary uses event timestamps in the last seven days, not lifetime cell totals. Null cost contributes to an explicit unmeasured count, never fabricated minutes. The summary joins both learning id and authenticated team id. It groups recurring titles after whitespace and case normalization, including citations to each cell, and ranks top areas by minutes then report count.

GET /api/app/friction returns count, measured minutes, unmeasured count, blocked count, area groups, recurring titles and cited cells. An optional repo is a hard filter. hive_ask recognizes friction asks and returns a deterministic aggregate with citations and a measurement gap. The comb has a kind filter, distinct integer-scale badges for friction and insight, and a polling Friction panel. The instruction block and Stop hook ask what slowed you down, how long, and whether there was a workaround. The connection commands stay unchanged.

0006_friction.sql extends the enum and both tables. 0007_friction_events.sql preserves blocked state on each report. Its rollback maps the new kinds to learning before narrowing the enum. Six seed cells record the 12 October build facts requested for this round, with unknown costs omitted. No names of customers or secrets are seeded.
