# Hivemind MVP spec

Hivemind is a shared memory for a team's coding agents. Each person adds one remote MCP server to Claude Code or Codex. Agents push learnings to the hive. Agents and people search and ask the hive.

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
  src/server/llm/            embeddings.ts, synthesize.ts, tagger.ts
  src/lib/install.ts         install snippet generators (pure)
packages/core                @hivemind/core: zod schemas, contracts, ranking, redaction
```

## Environment

| Name | Used for | Absent means |
| --- | --- | --- |
| `DATABASE_URL` | Postgres (Neon pooled URL in production) | routes that need the database return 503 with a clear message |
| `OPENAI_API_KEY` | `text-embedding-3-small` embeddings (1536 dims) | full-text search only, dedupe by normalized title |
| `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` synthesis, `claude-haiku-5-5` tagging | `hive_ask` returns an extractive answer, no auto tags |
| `HIVEMIND_PUBLIC_URL` | canonical URL in install snippets | falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then the request origin |

Local Postgres for development: `postgres://hivemind:hivemind@127.0.0.1:54329/<database>` (Docker container `hivemind-pg`, image `pgvector/pgvector:pg18`, extension `vector` 0.8).

Driver: `postgres` (postgres.js) with `drizzle-orm/postgres-js`, `prepare: false`, small pool (`max: 3`), one client cached on `globalThis`.

## Ids and keys

- Ids are text with a prefix and 12 lowercase base32 characters: `team_`, `mem_`, `key_`, `lrn_`, `ses_`, `ea_`, `ask_`.
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
type HiveContext = { teamId: string; teamName: string; memberId: string; memberName: string };

type LearningView = {
  id: string; title: string; body: string; kind: LearningKind; tags: string[];
  repo: string | null; paths: string[]; confidence: number; source: LearningSource;
  author: { id: string; name: string };
  pushCount: number; votes: { up: number; down: number; outdated: number };
  createdAt: string; updatedAt: string; lastPushedAt: string;
};

type SearchHit = LearningView & {
  score: number;
  signals: { vector: number | null; fts: number; recency: number; votes: number; repoMatch: boolean };
};

type PushResult = { id: string; merged: boolean; pushCount: number; redactions: number; learning: LearningView };
type AskResult = {
  answer: string;                      // markdown, cites inline as [lrn_xxx]
  citations: { id: string; title: string; why: string }[];
  confidence: "high" | "medium" | "low";
  gaps: string | null;
  synthesized: boolean;                // false = extractive fallback
};
type FeedbackResult = { id: string; votes: { up: number; down: number; outdated: number } };
type MemberView = { id: string; name: string; joinedAt: string; lastSeenAt: string | null; learningCount: number };
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
3. Embed `title + "\n\n" + body` (truncate to 8000 characters) when `OPENAI_API_KEY` exists. An embedding failure never fails the push.
4. Dedupe inside the same team and the same repo (null equals null): nearest neighbour with cosine similarity >= 0.90, or equal normalized title when there is no embedding. On a duplicate: increment `push_count`, set `last_pushed_at`, union tags and paths, keep the max confidence, keep the existing title, replace the body only when the new body is at least 1.5 times longer. Insert a `learning_pushes` row with `merged = true`. Return `merged: true` and the existing id.
5. Otherwise insert the learning and a `learning_pushes` row.
6. When tags are empty and `ANTHROPIC_API_KEY` exists, schedule `suggestTags` with `after()` from `next/server` and store up to 5 tags. This never delays or fails the push.

### Search
1. Candidate set = top 40 by cosine similarity (when the query embeds and the column exists) union top 40 by `ts_rank_cd(search, websearch_to_tsquery('english', q))`. When both are empty, fall back to a prefix `to_tsquery` on the query words. All inside `team_id = ctx.teamId`. `tags` is a hard filter (array overlap). `repo` is a boost, not a filter.
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
- `/app`: feed of learnings (author, time, repo, tags, kind, votes, push count), polling every 5 seconds; search box; "Ask the hive" box that shows the answer with clickable citations.
- `/app/members`: members, the invite code with a copy button.
- `/app/install`: snippets with copy buttons. A "Create a new key" button issues a key, shows it once and fills the snippets.
- Web API routes live under `/api/app/*` and authenticate with the session cookie. They call the same service functions as the MCP tools.
