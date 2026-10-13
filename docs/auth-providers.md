# Provider sign-in buttons

The login card uses provider branding on Sign in, Create a team and Join. Each button is 256px wide and centred. The Google artwork keeps its original aspect ratio. The card, tabs and email form retain Hive styling.

## Sources and attribution

Checked on 2026-10-13. All artwork and the button font are served locally from `apps/web/public/auth-providers`. There are no runtime brand-asset requests to third-party hosts.

- **Google:** `google-sign-in.svg` is the unchanged Android + Web, Light, Show text=Yes, Shape=Square asset from Google's [pre-approved sign-in asset bundle](https://developers.google.com/static/identity/images/signin-assets.zip). It includes the current gradient G, border, padding and outlined lettering. The whole image scales proportionally from 180×40 to 256×56.89. Use is governed by the [Google Identity branding guidelines](https://developers.google.com/identity/branding-guidelines) and [Google brand terms](https://about.google/brand-resource-center/guidance/). Google and the Google logo are trademarks of Google LLC.
- **Slack:** `slack.svg` contains the unchanged four logo paths from the [official button generator](https://api.slack.com/sign-in-with-slack-button-generator). The button uses its default 256×48 size, 20px mark, 12px gap, 4px corners and approved aubergine theme (#4A154B with white text). Lato Bold follows the [button design guidelines](https://docs.slack.dev/authentication/sign-in-with-slack/#button-design-guidelines). The generated anchor becomes a native button to call Hive's existing Better Auth handler. Slack marks belong to Slack Technologies, LLC, a Salesforce company, and remain subject to [Slack's brand guidelines](https://slack.com/media-kit).
- **AgentID:** `agentid.svg` is the unchanged [black SVG mark](https://www.agentid.com/brand/icon-black.svg). AgentID provides an official logo and minimal button markup, but no complete pre-styled button asset. Hive uses the markup from [Adding a Sign in with AgentID Button](https://www.agentid.com/blog/adding-a-sign-in-with-agentid-button), also published in [llms-full.txt](https://www.agentid.com/llms-full.txt). It uses the requested “Sign in with AgentID” label, which that guide explicitly permits. The [brand page](https://www.agentid.com/brand) instead recommends “Continue with AgentID” where first sign-in also creates an account. The mark is 20px with at least 10px clear space. The brand page permits these downloads for sign-in buttons; the mark belongs to AgentMail, Inc. It does not imply endorsement of Hive.
- **Lato:** `lato-bold-latin.woff2` is the unmodified Latin subset of Lato Bold from [Google Fonts](https://fonts.google.com/specimen/Lato), downloaded from [fonts.gstatic.com](https://fonts.gstatic.com/s/lato/v25/S6u9w4BMUTPHh6UVSwiPGQ3q5d0.woff2). The SIL Open Font License and copyright notice are included in `Lato-OFL.txt`.

## Behaviour and accessibility

Google and Slack still call `authClient.signIn.social` with the same provider, join callback, error callback and query string. AgentID still navigates to `/api/auth/agentid/start` with the query string. No server identity code, schema or migration changes are required.

Native buttons expose the exact provider labels as accessible names. Decorative images have empty alt text. Pending sign-in disables all provider buttons, sets `aria-busy` on the selected one and announces a status without changing the brand labels. A failed sign-in restores the buttons and shows the existing error panel.

Keyboard focus uses a 3px #1F1F1F outline with a 4px gap. Text contrast is 16.48:1 for Google, 14:1 for Slack and 21:1 for AgentID. Google and AgentID borders use #747775 (4.53:1 against white). The focus outline has 16.48:1 contrast against the white card.

`/app/consent` renders the signed-in consent form and does not render provider buttons. Its login flow uses the same login component. Query preservation is covered by the provider interaction tests.

## Verification

- Existing component render tests and ten provider interaction tests pass. The new tests cover all three providers on all three tabs, query preservation, pending state and retry after an error.
- `pnpm --filter web build` passes with the documented `NEXT_PUBLIC_C15T_BACKEND_URL` in the worktree's ignored `.env.local`.
- React Doctor reports no diagnostics in changed files. It reports 15 existing warnings elsewhere in the web package.
- Headless Firefox checks all three tabs at 1280×1000 and 390×844. All buttons are 256px wide, all local images load, keyboard focus is visible, and there are no page errors or horizontal overflows.
- Screenshots are in [screenshots/login-official-buttons](screenshots/login-official-buttons/). Captures use the running local Next.js dev server with placeholder provider configuration and the cookie banner dismissed through “Necessary only”. They do not exercise real provider credentials or complete an OAuth exchange.
