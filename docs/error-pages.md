# Error pages

Missing pages return a branded 404. Unknown API paths return `{"error":"not_found"}` with status 404, including unsupported auth endpoints. Signed-in visitors get a dashboard link; other visitors get a sign-in link.

The segment and global error boundaries share ErrorShell. The global boundary imports the product styles and shared fonts because it replaces the root layout. Retry calls the framework reset function. A server error reference is the same digest logged by the server.

`error.page_shown` records only the pathname and digest in event properties. It excludes queries, fragments, exception messages and identity. The endpoint checks origin, size and a strict input allowlist. The analytics writer retains its existing timeout and failure isolation. A database outage can prevent event storage; the server exception log still carries the reference.

Both products currently use light page palettes. The shell uses the existing semantic tokens and opaque sprite backgrounds, with whole-number sprite scales.

## Access and authentication

- Callback errors use allowlisted copy. Invalid or expired state goes to sign in. A stale MCP connection goes back to the agent connection flow.
- Denied OAuth consent still returns the protocol error to the requesting client. Browser callback denials show a branded explanation. Machine-readable token and MCP responses remain machine readable.
- Expired, invalid, revoked or exhausted invites retain their branded form and tell the person to request a new invite. Domain rejection tells the person to ask their team admin for an invite.
- Unverified email retains the verification form and code flow. Callback verification errors explain how to verify the email.
- Revoked keys stay 401/403 at the MCP boundary. The browser recovery page explains how to create a new key. Keys are not accepted as a web sign-in method.
- Missing membership and insufficient admin roles use the 403 boundary. Membership checks remain in the service layer. Switch account is a link to a page with a server-action sign-out button, so a prefetched GET cannot sign someone out.
- Unknown or removed organisations cannot expose private organisation data. Wolf displays the requested organisation identifier when it has no membership; it displays the workspace name for an insufficient role. Hive can display the person's own former hive name.

## Hive `/auth`

`/auth?state=...` is not a callback alias. The exact URL was a mocked Executor response in `packages/cli/test/executor.test.mjs`. That fixture now uses an `.example.test` host. No deployed route or production caller uses `/auth`. The active sign-in callback is under `/api/auth/callback/*`, and MCP discovery points to `/api/auth/oauth2/*`; `/oauth2/*` is the compatibility alias. `/auth` stays a branded 404. Guessing an alias from an untrusted state parameter would discard the actual callback protocol.

## Verification

Run `pnpm -r typecheck`, `pnpm test` and `pnpm --filter web build`. Error-page tests cover signed-in and anonymous 404s, session-storage failure, retry clicks, digest privacy, beacon deduplication, auth recovery and unknown API responses. Browser checks use temporary untracked `error-fixture` and `retry-fixture` pages. The throwing routes are removed before the production commit.

Screenshots in `docs/screenshots/error-{404,500}-{1280,390}.png` use 1280 × 800 and 390 × 844 CSS viewports. The 500 capture comes from a local production build with a temporary server throw. Pixel dimensions can reflect the automation browser's device scale factor.
