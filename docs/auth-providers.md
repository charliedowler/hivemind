# Provider sign-in buttons

The login card uses provider branding on Sign in, Create a team and Join. Each button spans the card content width and is 44px high. The stack uses the same 20px gap as the email fields. Each 20px logo sits at a fixed left inset, with the label centred in the remaining space. The card and tabs retain Hive styling.

## Sources and attribution

Checked on 2026-10-13. All artwork and the button font are served locally from `apps/web/public/auth-providers`. There are no runtime brand-asset requests to third-party hosts.

- **Google:** The button uses the state layer, content wrapper, icon wrapper and label from Google's [official HTML configurator](https://developers.google.com/identity/branding-guidelines#render-html-button), scoped through the CSS module. Width and height adapt to the card. The logo is 20px, horizontal padding is 12px and the logo-to-label space is 10px. `google.svg` isolates the unchanged gradient G and definitions from the [pre-approved asset bundle](https://developers.google.com/static/identity/images/signin-assets.zip) with a 20×20 viewBox; it does not stretch or recolour the logo. Google Sans Medium is 14px with 20px line height, per the current [Google Identity branding guidelines](https://developers.google.com/identity/branding-guidelines). `google-sans-medium.woff2` is the 2.2KB Google Fonts subset for the fixed label, with its SIL Open Font License in `Google-Sans-OFL.txt`. Google and the Google logo are trademarks of Google LLC and subject to [Google brand terms](https://about.google/brand-resource-center/guidance/).
- **Slack:** `slack.svg` contains the unchanged four logo paths from the [official button generator](https://api.slack.com/sign-in-with-slack-button-generator). The button uses a full-width, 44px layout, 20px mark, 4px corners and approved aubergine theme (#4A154B with white text). Lato Bold follows the [button design guidelines](https://docs.slack.dev/authentication/sign-in-with-slack/#button-design-guidelines). The generated anchor becomes a native button to call Hive's existing Better Auth handler. Slack marks belong to Slack Technologies, LLC, a Salesforce company, and remain subject to [Slack's brand guidelines](https://slack.com/media-kit).
- **Lato:** `lato-bold-latin.woff2` is the unmodified Latin subset of Lato Bold from [Google Fonts](https://fonts.google.com/specimen/Lato), downloaded from [fonts.gstatic.com](https://fonts.gstatic.com/s/lato/v25/S6u9w4BMUTPHh6UVSwiPGQ3q5d0.woff2). The SIL Open Font License and copyright notice are included in `Lato-OFL.txt`.

## Behaviour and accessibility

“Or use your email” is a native disclosure with a link-style summary on all three tabs. It reveals the existing form inline and keeps entered values when closed and reopened. It starts open for `?email` (including an empty value) and email-recovery errors. Error-page links for email recovery include `?email`. Other authentication errors retain their existing error pages. With no configured providers, the email form stays visible.

Google and Slack still call `authClient.signIn.social` with the same provider, join callback, error callback and query string. Coding agents connect with Hive-issued credentials instead of a social provider.

Native buttons expose the exact provider labels as accessible names. Decorative images have empty alt text. Pending sign-in disables all provider buttons, sets `aria-busy` on the selected one and announces a status without changing the brand labels. A failed sign-in restores the buttons and shows the existing error panel.

Keyboard focus uses a 3px #1F1F1F outline with a 4px gap. Text contrast is 16.48:1 for Google and 14:1 for Slack. Google borders use #747775 (4.53:1 against white). The focus outline has 16.48:1 contrast against the white card.

`/app/consent` renders the signed-in consent form and does not render provider buttons. Its login flow uses the same login component. Query preservation is covered by the provider interaction tests.

## Verification

- Component render tests, error-page tests and provider interaction tests pass. Current tests cover Google and Slack on all three tabs, email access, query preservation, pending state and retry after an error.
- `pnpm --filter web build` passes with the documented consent backend and local auth/database fixture values in the worktree's ignored `.env.local`. No database connection is needed for this build.
- React Doctor reports no diagnostics in changed files. It reports 15 existing warnings elsewhere in the web package.
- Headless Firefox checks all three tabs at 1280×1000 and 390×844. Buttons match the email input width and are exactly 44px tall. All local images load, keyboard focus is visible, and there are no page errors or horizontal overflows. Checks cover email expansion, preservation of entered email, initial query/error expansion, invite preservation and an inline failed email sign-in.
- Earlier button screenshots are in [screenshots/login-official-buttons](screenshots/login-official-buttons/); they predate the removal of the agent provider. Captures use the running local Next.js dev server with placeholder provider configuration and the cookie banner dismissed through “Necessary only”. They do not exercise real provider credentials or complete an OAuth exchange.
