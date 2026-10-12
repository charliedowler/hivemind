# Learning backend verification

Implementation is complete on main. Production deployment of the tree and dashboard is blocked by Vercel's young Hobby team deployment limit. The last verified live code is `33181d4`. Git and direct CLI deployment both report that more than 100 deployments were created in 24 hours. The live tree routes and new dashboard still need verification after capacity returns.

## Verified on gohive.dev

The registered Hive MCP on the Mac pushed a real correction:

- Previous cell: `lrn_k5vyj4mcfdhi`, “Vector deduplication does not fall back to normalized titles”.
- Replacement: `lrn_vx4lovrs25p2`, “Hive deduplication now compares normalized titles before merging facts”.
- Default search excludes the previous cell and includes the replacement.
- History search still finds the previous cell.
- Ask cites both ends of the chain and adds an as-of date.
- The previous cell has versions 1 and 2 and a persisted successor pointer.

Migrations `0009_lifecycle.sql` and `0010_knowledge_tree.sql` are applied in production. The private Blob store is connected to production and development. A real put/get round trip returned identical bytes; an unauthenticated object read returned HTTP 403.

## Verified with the local production build

The build runs on loopback against the real database and private Blob store. These checks prove the implementation and storage integration, but do not prove the blocked Vercel deployment:

- All three new MCP tools work: browse, read and snapshot.
- The snapshot downloaded and decompressed, contained 129 generated files and included the replacement. A subsequent real push and rebuild published revision 6 with 133 files.
- A real redacted push with a session excerpt and diff uploaded its evidence as a JSON object. Its temporary database payload cleared, and the downloaded object matched the recorded SHA-256 digest. The first pre-release capture exposed double serialization; the write now uses the postgres-js JSON serializer, and the regression test checks the archived fields. That first archive is preserved verbatim and can be decoded with a second JSON parse.
- The replacement title opens the current cell. Version history returns both revisions.
- Friction chips display titles, truncate on narrow screens and open the cell dialog.
- The Conflicts panel shows the real accepted replacement. No invented conflict was seeded.
- Desktop and mobile checks found no browser errors or horizontal overflow.

Screenshots were viewed after capture. The `backend-local-` prefix identifies their provenance:

| View | Desktop | Mobile |
| --- | --- | --- |
| Superseded cell | [1280](screenshots/backend-local-superseded-1280.png) | [390](screenshots/backend-local-superseded-390.png) |
| Conflicts | [1280](screenshots/backend-local-conflicts-1280.png) | [390](screenshots/backend-local-conflicts-390.png) |
| Knowledge tree | [1280](screenshots/backend-local-tree-1280.png) | [390](screenshots/backend-local-tree-390.png) |
| Friction titles | [1280](screenshots/backend-local-friction-1280.png) | [390](screenshots/backend-local-friction-390.png) |

## Automated checks

- `pnpm -r typecheck`: pass.
- `pnpm -r test` with an isolated Postgres database: 205 pass, one opt-in live model test skipped.
- `pnpm --filter web build`: pass.
- Upgrade from migrations 0001–0008 with existing fresh, confirmed and outdated fixtures: correct backfill, one version per cell and non-null verification horizons. Applying 0009 and 0010 twice succeeds without extra versions.
- Integration coverage includes team isolation, stale revisions, concurrent replacements, distinct member votes, retrieval/ask history, evidence redaction, failed publication recovery, an older publisher racing a newer one, verification deadlines, tar contents, expired capabilities and removed members.
- React Doctor: no errors and no diagnostics in dashboard components. Four server/script advisories remain: one pre-existing seed loop and three deliberately sequential loops for transaction ordering and draining dependent publication batches.

## Release follow-up

Restore Vercel deployment capacity or wait for its reset. Deploy main, confirm its SHA at `/api/health`, then repeat the tree tools and capture the same views from `https://gohive.dev`. No new secret or database migration is needed. The completion marker must stay gated until this final production verification is complete.
