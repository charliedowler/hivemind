# Self-hosting Hive

Hive is a Next.js app (`apps/web`) backed by Postgres with pgvector, plus an npm CLI (`packages/cli`, published as `gohive`) and an agent skill (`skills/hive`). Every deployment-specific value is an environment variable; `apps/web/.env.example` lists them all with comments.

## Required environment

| Variable | Where to get it |
| --- | --- |
| `DATABASE_URL` | Postgres 16+ with the `vector` extension. Neon works; on Vercel the Neon integration sets it. |
| `PUBLIC_URL` | The public origin, for example `https://hive.example.com`. Links, invite URLs, OAuth and install snippets use it. If you set it at build time, `www.<host>` redirects to it. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | `openssl rand -base64 32`; `BETTER_AUTH_URL` is normally your `PUBLIC_URL`. |
| `OPENAI_API_KEY` | OpenAI API key for embeddings. |
| `ANTHROPIC_API_KEY` | Claude API key for answers and summaries. |
| `CRON_SECRET` | Any long random string. Vercel Cron sends it to the routes in `apps/web/vercel.json`. |

## Optional environment

| Variable | Purpose |
| --- | --- |
| `OPERATOR_NAME`, `OPERATOR_EMAIL` | Who runs this deployment, shown on the privacy and terms pages and footers. Set both for a public deployment; the legal pages are a starting point, not legal advice. |
| `TYPESAFE_API_KEY` | Judgement model for classification, conflicts and the Slack gate. Without it Hive uses deterministic fallbacks. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email codes and invites. Verify a sending domain in Resend. |
| `BLOB_READ_WRITE_TOKEN` | A private Vercel Blob store for hive exports and decision payloads. |
| `NEXT_PUBLIC_C15T_BACKEND_URL` | Cookie consent. Create a c15t project at Inth and copy its hosted backend URL. Trust your domain, its `www.` alias, the `*.vercel.app` alias and `localhost:3000`. The build downloads the policy from this URL. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth web client. Redirect URI `<PUBLIC_URL>/api/auth/callback/google`. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | From your Slack app. Enables Sign in with Slack and the Slack integration. |
| `AGENTID_CLIENT_ID`, `AGENTID_CLIENT_SECRET` | AgentID client for agent sign-in. See `docs/agentid.md`. |
| `SLACK_SIGNING_SECRET`, `SLACK_TOKEN_ENCRYPTION_KEY`, `SLACK_APP_ID` | Hive in Slack. Create the app from `docs/slack-manifest.json` after replacing the example domain. The encryption key is 32 random bytes in base64. Set `SLACK_APP_ID` to your app's ID so events for other apps are ignored. |
| `HIVE_ANALYTICS_TRAFFIC` | `real` or `synthetic`, to label test deployments in analytics. |

## Deploy to Vercel

1. Import the repository and set the root directory to `apps/web`. Any project name works.
2. Add a Postgres database with pgvector (for example the Neon integration).
3. Add the required variables for Production and Preview.
4. Run migrations against the new database (below), then deploy.
5. Check `<PUBLIC_URL>/api/health`. It returns the deployed commit.

The Slack integration uses a Vercel Queues trigger (`apps/web/vercel.json`). On another host, replace that trigger with your own queue consumer or leave Slack off.

## Database

Migrations are plain SQL files in `apps/web/drizzle`. The runner records applied files in `_migrations` and skips them next time. Rollbacks live in `apps/web/drizzle/rollback`.

```sh
DATABASE_URL=... pnpm --filter web db:migrate
```

Run it before deploying code that needs a new migration.

## Run locally

```sh
pnpm install
docker run -d --name hivemind-pg -e POSTGRES_USER=hivemind -e POSTGRES_PASSWORD=hivemind \
  -e POSTGRES_DB=hivemind -p 127.0.0.1:54329:5432 pgvector/pgvector:pg18
cp apps/web/.env.example apps/web/.env.local   # add OPENAI_API_KEY and ANTHROPIC_API_KEY
pnpm --filter web db:migrate
pnpm dev
```

## Point the CLI and skill at your deployment

The `gohive` CLI and the `skills/hive` scripts default to the hosted service at `https://gohive.dev`. The skill scripts read `HIVE_URL`; set it to your `PUBLIC_URL`. MCP clients can use `<PUBLIC_URL>/api/mcp` directly:

```sh
claude mcp add --transport http hive https://hive.example.com/api/mcp --scope user
codex mcp add hive --url https://hive.example.com/api/mcp
```

## CI and npm publishing

- `.github/workflows/ci.yml` runs typecheck, tests and a build against a disposable Postgres service. Set the repository variable `C15T_BACKEND_URL` (Settings, Secrets and variables, Actions, Variables) to your c15t backend URL; the build needs it.
- `.github/workflows/publish-gohive.yml` publishes `packages/cli` to npm when its version changes on `main`. It uses npm trusted publishing (OIDC): no npm token is stored. Configure a trusted publisher on npmjs.com for your package with this repository, the workflow file name `publish-gohive.yml` and the environment `npm`.
- Provenance attestations need a public repository. The workflow sets `NPM_CONFIG_PROVENANCE: "false"` while the repository is private. Remove that line (or set it to `"true"`) once the repository is public.
- To publish under a different name, change `name` in `packages/cli/package.json`; the workflow reads it from there.

## Checks

```sh
pnpm typecheck
pnpm test          # integration tests run when DATABASE_URL is set
pnpm build
```
