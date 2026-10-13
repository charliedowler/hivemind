# Cookie consent

Hive uses hosted c15t 3.0.0. The install adds one consent root, a banner, a preferences dialog and an app-owned Cookie preferences button in the root footer. The banner and dialog use Hive's honey, wax, ink, fonts, chamfered corners and hard shadows. The service remains usable without optional measurement.

## Hosted setup

| Setting | Value |
| --- | --- |
| Path | INSTALL; no previous consent manager |
| Inth CLI | `@inth/cli@0.0.7` |
| Organisation | `org_11124krgyz2cbmu48m12bewcci281w` (`charlie-products`) |
| Project | `prj_11124krhfenpsyww3dmb39qtdqr8qh` (`hive`) |
| Region | `eu-central-1`, Europe (Frankfurt) |
| Backend URL | `https://hive-charlie-products.inth.app/` |
| App packages | `c15t@3.0.0`, `@c15t/integrations@3.0.0` |
| Core | One installed `@c15t/core@3.0.0`; no overrides |
| Public variable | `NEXT_PUBLIC_C15T_BACKEND_URL` |
| Vercel project | `charlie-s-team4/hivemind-hq` |
| Vercel environments | Production, preview and development |

The backend URL comes verbatim from `inth project get`. It contains no management credential. CLI credentials stay outside the repository and browser bundle. No billing or plan settings change.

The intended trusted origins are `gohive.dev`, `www.gohive.dev`, `hivemind-hq.vercel.app` and `localhost:3000`. Charlie requests no preview wildcards. The saved setup previously included `*.vercel.app` and additional local ports. Current verification and removal of the wildcard require renewed Inth access. The hosted policy stays at its default.

`withConsentManifest` fetches the public policy during the build. `resolveConsent` resolves each request from that snapshot and streams it to `ConsentRoot`. Each route under the root is dynamic. The browser sends choices to the hosted `/subjects` endpoint. `reportSessions: false` disables detached server consent-session reports. Rebuild after a hosted policy change. A missing manifest fails the production build by default.

## Inventory and handling

The target is `apps/web`, a TypeScript Next.js 16.4 App Router app with server and client components, pnpm 10.28.2, English copy and the Hive pixel design system.

| Tool or call | Files and IDs | Purpose | Previous gate | Handling |
| --- | --- | --- | --- | --- |
| First-party page beacon | `src/components/analytics-beacon.tsx`; `/api/analytics/page`; `{ page: 'landing' \| 'waitlist' \| 'install' }`; server event `page.viewed`; no vendor ID | Measurement | None | This branch supplies the same component signature and payload, guarded by `useMeasurementConsent`. No mount or event history is queued while denied. |
| First-party cell beacon | Same component; `/api/app/analytics/view`; `{ learningId }`; no vendor ID | Measurement | None | Same explicit measurement gate and one send per current key. |
| Trackers, pixels, tag managers and embeds | No optional vendor loader, ID, global or iframe found in the current app | None present | None | No helper, vendor script or duplicate loader is added. |
| Authentication | `src/server/auth.ts`, `src/server/identity/access.ts`; `hm_session` | Necessary | Session checks | Unchanged. |
| Product API calls and server email/model services | `src/lib/client.ts`, server services | Run the requested product feature | Product access rules | Unchanged. They are not optional browser tracking. |
| Fonts | Root `next/font/google`; design system `app.css` | Display the app | Build downloads fonts | Fonts are self-hosted in the production build. No Google Fonts request occurs in the tested browser session. |

Every optional measurement call must send zero requests before opt-in. `useMeasurementConsent` requires both effective c15t permission and a recorded measurement grant. An opt-out or no-banner policy default alone is insufficient. A recorded withdrawal or denied effective permission turns the gate off. c15t keeps its default reload on consent withdrawal.

The beacon sends a new event for the current view after a grant. It stores no historical views or payloads. It does not retry or replay an event captured before consent. A repeated render of the same current key sends nothing further.

## Analytics integration

Main now includes the page and cell beacon mounts and ingestion routes. The merge retains the existing paths, payloads and event names and gates the shared beacon with `useMeasurementConsent`. The new `/api/analytics/error` beacon records `error.page_shown` and uses the same measurement gate. It sends no error measurement before an explicit grant or after withdrawal. No denied event history is queued.

Normal routes, nested error pages and the 404 inherit the root consent footer. The global error page replaces the root layout, so it mounts its own consent root, banner, dialog and footer. Without server state this fallback resolves through the hosted backend.

## Hosted default policy limitation

Charlie instructs this setup to retain Inth's default policy and plan. No policy override is supplied locally.

Inth's `world_no_banner` rule has `model: 'none'`, `prompt: 'none'` and no rights. c15t hides its stock preferences link and dialog under that rule. Hive's app-owned Cookie preferences button stays visible independently and requests the c15t dialog through `useSetActiveUI`, but c15t still refuses to render the dialog in these regions. Its kernel also returns from category saves without recording a choice under a `none` evaluation policy.

Therefore the unchanged default policy cannot provide a working worldwide opt-in path. With Australia selected, the button is visible, no dialog opens, no measurement grant is stored and no beacon fires. This is a verified limitation, not a completed worldwide preference flow. Merely replacing the dialog markup would not fix consent recording.

The default opt-in and opt-out regions retain the normal dialog. The strict hook prevents tracking before an explicit grant in every region. Charlie owns any later decision to change the hosted policy or plan. The account's ability to edit policies is unverified: the dashboard requires a separate login, and its consent read endpoint returns HTTP 401 in the available browser session. No billing action is taken.

## Verification on 13 October 2026

Checks use a production Next.js build, an incognito browser session and network/storage inspection. A temporary, uncommitted page mounts the real beacon and logs fetch/sendBeacon calls before hydration. The temporary page, instrumentation and country override are removed before the final build and commit.

| Check | Verified result |
| --- | --- |
| First visit, unknown location fallback | Banner shown; no third-party resource request, beacon, consent cookie or localStorage entry before choice |
| Reject optional | Hosted `POST /subjects` returns 200; measurement choice is false in the consent cookie/localStorage; no beacon |
| Reload after rejection | Choice persists; no banner or beacon; preferences reopen with measurement off |
| Accept all | Hosted save returns 200; one landing beacon after the new grant |
| Additional views | One waitlist, one install and one cell request; repeated waitlist click sends no duplicate |
| Withdraw and reload | Hosted save returns 200; automatic reload; measurement is off; later view sends no beacon |
| Granular measurement | Necessary stays enabled and disabled for editing; measurement toggle plus Save returns 200 and permits only measurement |
| Blocked backend | Initial page still denies measurement with no request; blocked rejection stays local and queues only the consent save; no beacon after reload; unblocking retries the save with HTTP 200 |
| Keyboard | Tab wraps inside the stock dialog; Escape returns focus to Cookie preferences; Enter reopens it |
| Narrow viewport | Dialog fits at 390px without horizontal overflow; actions remain visible and usable |
| No-banner region (Australia) | No banner; app-owned footer button visible; dialog cannot open; no measurement request or stored grant |

The build-time manifest removes the browser initialization request, so an unavailable backend does not prevent the tested first page from resolving its bundled policy. Blocking the save endpoint exercises actual hosted submission failure separately.

Typecheck and production build pass. Tests pass: 59 core tests and 119 web tests. The 34 database integration tests are skipped because no isolated test database is configured. React Doctor reports no diagnostics on touched files; four warnings in untouched scripts/server code predate this change. No merge or manual deployment occurs.

## Sources

The version-matched package includes `SKILL.md`, `AGENTS.md`, setup selection, Next.js quickstart, customization, hooks, callbacks, preferences and integration guides. The corresponding current documentation is on [c15t.com](https://c15t.com/docs/frameworks/next/quickstart). The [ConsentDialog guide](https://c15t.com/docs/frameworks/next/components/consent-dialog) and [ConsentWidget guide](https://c15t.com/docs/frameworks/next/components/consent-widget) describe the `none` restriction. The installed `@c15t/core` kernel choice recorder confirms that category saves under `none` record nothing. Browser network and storage checks confirm the results above.

## Changed files

- `apps/web/.env.example`: public backend URL.
- `apps/web/package.json`, `pnpm-lock.yaml`: exact package versions.
- `apps/web/next.config.ts`, `apps/web/c15t.config.ts`: manifest build and consent configuration.
- `apps/web/src/app/layout.tsx`, `apps/web/src/app/privacy.css`: root surfaces, footer and pixel styles.
- `apps/web/src/app/privacy/page.tsx`: consent storage and measurement wording.
- `apps/web/src/components/cookie-preferences-link.tsx`: app-owned persistent control.
- `apps/web/src/components/analytics-beacon.tsx`: guarded page and cell beacon.
- `apps/web/src/lib/measurement-consent.ts`, `apps/web/src/lib/measurement-consent.test.tsx`: strict gate and six permission/choice tests.
- `docs/cookie-consent.md`: setup, inventory, verification, limitation and analytics merge instructions.
- `docs/screenshots/consent-*`: real screenshots from the final local production build.
