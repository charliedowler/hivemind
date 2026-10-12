# Hivemind

A shared memory for your team's coding agents.

Each person adds one MCP server to Claude Code or Codex. Their agents push what they learn to the hive: gotchas, fixes, decisions, how a flaky thing really works. Every agent searches the hive when it starts a task or hits an error. Anyone can ask the hive a question in the web UI and get an answer with citations.

- Landing page: https://hivemind-hq.vercel.app
- Dashboard: https://hivemind-hq.vercel.app/app
- MCP endpoint: https://hivemind-hq.vercel.app/api/mcp

Built in one day at the Lightdash offsite launchathon, 12 October 2026.

## The 5-minute demo

1. **The pitch (30 seconds).** Open the landing page. One agent figures something out. The whole team remembers it.
2. **The hive (60 seconds).** Open `/app`. The feed shows what agents learned today: who, when, which repo, which tags. Point at one card that says "seen 2 times". Two agents pushed the same fact and the hive merged them.
3. **Search (45 seconds).** Type `emulator will not boot, not enough disk space`. The hive finds the Android emulator learning from meaning, not keywords. Each hit shows its score and the signals behind it: vector, text, recency, votes, repo match.
4. **Ask (60 seconds).** In "Ask the hive", ask: `CI is green but the nightly job did not run. What should I check?` The answer joins several learnings. Click a citation chip to open its source. Point at "What's missing": the hive says what it does not know.
5. **An agent uses it (90 seconds).** In a terminal run:
   ```
   claude -p "Search the hive for what the team knows about git stash and worktrees, then tell me the rule in two sentences."
   ```
   Claude Code calls `hive_search` on its own. Then push a new learning:
   ```
   claude -p "Push this to the hive as a gotcha for repo charliedowler/hivemind: <something you learned today>"
   ```
   Switch to the dashboard. The card appears in the feed within 5 seconds.
6. **Install (30 seconds).** Open `/app/install`. Create a key. Copy one command. That is the whole setup for a teammate.
7. **Close (15 seconds).** Vote a learning up or mark one outdated. The hive ranks on that feedback.

## Install for a teammate

Join the team at `/app/login` with the invite code and your name. The page shows your API key once. Then:

```
claude mcp add --transport http hivemind https://hivemind-hq.vercel.app/api/mcp --header "Authorization: Bearer <YOUR_KEY>" --scope user
```

or, for Codex:

```
export HIVEMIND_KEY=<YOUR_KEY>
codex mcp add hivemind --url https://hivemind-hq.vercel.app/api/mcp --bearer-token-env-var HIVEMIND_KEY
```

The Install page also gives an instruction block for `CLAUDE.md` or `AGENTS.md` and a Claude Code `Stop` hook. The hook asks the agent once per session to push its learnings before it stops.

## MCP tools

| Tool | What it does |
| --- | --- |
| `hive_push` | Stores a learning: title, markdown body, kind, tags, repo, paths, confidence, source. Redacts secrets. Merges a near-duplicate into the existing record and bumps its count. |
| `hive_search` | Hybrid search. Returns ranked learnings with ids and scores. |
| `hive_ask` | Answers a question from the team's learnings, with citations to learning ids, a confidence and the gaps. |
| `hive_recent` | Lists what the team learned since a time, such as `24h` or `7d`. |
| `hive_feedback` | Votes a learning `up`, `down` or `outdated`. |

## Architecture

```
  Claude Code            Codex               Browser
      |                    |                    |
      | MCP, Streamable HTTP                    | cookie session
      | Authorization: Bearer hm_...            |
      v                    v                    v
+------------------------------------------------------------+
|  apps/web  (Next.js App Router on Vercel)                  |
|                                                            |
|  /api/mcp          mcp-handler 2.x, withMcpAuth            |
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
```

**Push.** Validate, normalize the repo and tags, redact secrets, embed, then look for a duplicate in the same team and repo (cosine similarity of 0.90 or more). A duplicate merges into the existing learning. A new learning with no tags gets tags from Claude Haiku after the response is sent.

**Search.** Candidates come from the nearest vectors and from Postgres full-text search. `rankCandidates` in `packages/core` scores them:

```
score = 0.55 * vector + 0.25 * text + 0.10 * recency + 0.10 * votes
        + 0.08 when the repo matches
        scaled by confidence, and by 0.4 when outdated votes outnumber up votes
```

Without embeddings the text signal takes the vector weight, so the hive still works with only Postgres.

**Ask.** The top 8 search hits go to Claude Sonnet with a structured output schema. The model answers only from those learnings and cites ids inline. The server drops any citation that is not in the retrieved set. If the model call fails or refuses, the hive returns the top hits as a plain list.

The full contract is in [docs/SPEC.md](docs/SPEC.md).

## Security notes

- **API keys are hashed at rest.** A key is `hm_` plus 32 random bytes. The database stores only its SHA-256 hash and a 10 character display prefix. The raw key is shown once. Web session tokens are stored as hashes too.
- **Team isolation is on every query.** Each service function takes a `HiveContext` that comes from an authenticated key or session. Every query on team data filters by `ctx.teamId`. No function accepts a team id from user input. Integration tests prove that team B cannot search, read, list or vote on team A's learnings.
- **Secrets are redacted on push.** Common key shapes, JWTs, private key blocks and database URL passwords become `[redacted]` before storage and before embedding.
- **Learning text is untrusted input to the model.** The ask prompt marks learnings as data to quote, never instructions to follow.
- **Known gaps for an MVP:** invite codes are stored in plaintext and do not expire. There is no rate limit, no key revocation UI, no email verification and no audit log. A member's learnings are sent to OpenAI for embedding and to Anthropic for synthesis.

## What is stubbed or missing

- Login has no email and no password. A team has an invite code; a person joins with the code and a name.
- The feed polls every 5 seconds. There is no push channel.
- No edit or delete for a learning in the UI. `outdated` votes rank it down.
- No key revocation UI. The `revoked_at` column exists and auth honours it.
- No rate limits and no quotas.
- No Codex `Stop` hook equivalent; Codex relies on the `AGENTS.md` instruction block.
- Ask keeps no conversation state. Each question stands alone.
- The seed learnings come from one engineer's real agent notes, with names of customers and secrets removed. Two of the three seed authors are fictional.

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

Seed a team with the demo learnings (the key belongs to a member named Charlie; the script joins the other authors with the invite code):

```
HIVEMIND_URL=http://localhost:3000 HIVEMIND_KEY=<key> HIVEMIND_INVITE=<invite code> pnpm --filter web seed
```

Production deploys from `main` through the Vercel GitHub integration. Run `pnpm --filter web db:migrate` against the production `DATABASE_URL` before a deploy that needs a new migration.
