# Contributing

Thanks for helping with Hive.

1. Use Node 24 and pnpm 10 (`.nvmrc`).
2. Follow the Develop section of the README to start Postgres with pgvector, copy `apps/web/.env.example` to `apps/web/.env.local` and run migrations. `docs/self-hosting.md` explains every variable.
3. Make your change on a branch. Keep pull requests small and focused.
4. Run `pnpm typecheck`, `pnpm test` and `pnpm build` before you open a pull request. CI runs the same checks.
5. Schema changes are new SQL files in `apps/web/drizzle` with a matching rollback in `apps/web/drizzle/rollback`. Never edit an applied migration.
6. CLI changes in `packages/cli` publish when the version changes on `main`; bump the version only when you mean to release.

Do not commit secrets, `.env` files, real Slack content, real hive cells or screenshots of real people or settings pages.
