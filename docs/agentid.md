# AgentID sign-in

Hive accepts [AgentID](https://www.agentid.com) so coding agents can use their own account and join a human's team. People keep their existing email, Google and Slack sign-in methods.

## Configuration

Hive uses Better Auth 1.7.7 and the AgentMail Generic OAuth helper. The [provider guide](https://www.agentid.com/docs/better-auth) describes the protocol settings. Set both values on the server:

| Variable | Value |
| --- | --- |
| `AGENTID_CLIENT_ID` | The Hive application's registered client id |
| `AGENTID_CLIENT_SECRET` | The once-shown client secret |

The button stays hidden when either value is missing. Credentials belong in your Vercel project's production environment variables. Never expose them in client code, logs, screenshots or documentation.

Register these callback addresses in the AgentID console:

- `https://gohive.dev/api/auth/callback/agentid`
- `http://localhost:3000/api/auth/callback/agentid`

Use Better Auth and `client_secret_basic`. Set the initiate login URL to `https://gohive.dev/api/auth/agentid/start`. Hive requests `openid email profile owner_profile owner_email` on each sign-in. Registration metadata does not set the request scopes. Set "Maximum signups per owner" to blank, which means unlimited. Hive imposes no cap on agent members per team, agents per owner, or MCP OAuth grants per account or team. Claude Code, Codex, Executor and other harnesses can each connect separately. Every later agent follows the same verified-owner join rule as the first.

Apply the reviewed additive migration `0026_agentid.sql` with `pnpm --filter web db:migrate` from the landing commit before deploying code. Its rollback refuses to discard agent identities or owner invitations.

## Identity and permissions

The provider uses authorization code flow with PKCE S256. Better Auth verifies the ES256 id token against AgentID discovery and JWKS, checks the issuer and client audience, then calls userinfo. The helper deliberately disables nonce binding because AgentID does not echo the nonce; PKCE protects the callback. AgentID codes last 60 seconds; its access and id tokens last ten minutes. It issues no refresh tokens. Hive sessions and MCP grants have their existing independent lifetimes. Removing an agent from Hive revokes its membership and sessions. Revoking AgentID credentials does not end an existing Hive session automatically.

The account key is `(agentid, sub)`, stored in Better Auth's `auth_accounts`. Emails are contact addresses, never account keys. Hive rejects a new subject reusing an existing inbox address rather than transferring the old account or merging it with a person. The current member schema requires unique emails.

`members.actor_type` is `agent` or `human`. The database prevents agents from receiving the admin role. `auth_accounts` stores nullable `owner_sub`, `owner_name`, `owner_email` and `owner_email_verified`. Hive refreshes those claims from `/v0/userinfo` on sign-in and checks that its `sub` matches the account. Owner email is stored for team matching only when `owner_email_verified` is true. The owner is never substituted for the agent's identity. Members show "name · agent of owner name", or "name · agent" when the name is absent.

Agents can read, search, push, give feedback and ask as members. They cannot manage members, Slack, privacy rules or keys. AgentMail domains, their subdomains and agents using a custom email domain cannot use verified-domain joining.

## Personal Hive and organisation membership

A registered AgentID owner contact creates a provisional human and one personal hive. Owner details stay separate from human login proof. A provisional human has no password, human session or organisation authority. Multiple agents with the same owner share the personal hive and project selection.

Hive sends one welcome email with a signed, single-use link valid for 24 hours. The claim checks the exact member and email, refuses account collisions, then verifies the human and creates the session in one transaction. Google and Slack with verified email can also claim the same provisional identity. Owner claims never verify an established password account.

A verified human joins enabled work domains automatically at sign-in and the next authenticated page load, before website or MCP consent redirects. Removed memberships remain tombstones. The organisation is the first selection and the one-line join notice is consumed once per session. Humans retain their personal hive when joining organisations. Agents follow active owner memberships as members, never admins. Removal tombstones prevent automatic reenrolment. Agents create no organisation hives. Explicit invitations take precedence over personal redirects; joining itself publishes no projects.

A three-word phrase is a domain-gated locator. `hive_join` needs a human token or a live human-granted capability. Without it, return the human join link: “Open <joinUrl> to join <team>”. Separate publication grants share selected projects into named organisations.

## Installer identity

Run `npx gohive@latest install` when a person is present. Sign in as them with Google or Slack; use agent identity only when no human is at the keyboard. Harness markers label the runtime but never choose AgentID on their own. `--identity agent` or `--headless` selects the agent path. CI and environment markers never select agent identity. Never create an AgentMail inbox for a person.

The installer prints the sign-in URL and returns promptly. OAuth waits in a background callback; `gohive status` resumes setup, checks access and completes a supplied `--join-url` with the human token. Agent mode returns its AgentID URL immediately so the agent can act on the waiting-page approval command. A known inbox supplies `login_hint`; an API key alone never identifies an inbox. Approval happens at exactly `https://auth.agentid.com`.

The installer uses `<harness> on <hostname>` as the local Hive display name. Hive sanitises it to 80 characters and disambiguates collisions on first join. It does not rename the AgentMail inbox. Separate inboxes appear as separate agents under their owner; the same inbox retains one identity across browsers. Recreating an address creates a new AgentID subject and cannot take over the former Hive identity.

Existing installed and signed-in clients skip account creation and login. An existing project selection skips the project question. A supplied join link goes straight to `hive_join`. Headless setup without an existing selection captures nothing. `--yes` installs without starting browser sign-in.

## Capture timing

Hive saves when something is learned, not when the session ends. The skill prompts an immediate push for a proven fix and cause, a decision and reason, a gotcha or workaround, and friction with measured time only. Claude Code keeps Stop as a background safety net and adds PreCompact and SubagentStop with the same selection, Jev gate and receipt/content dedupe. PostToolUse nudges only after the same test/build command fails then passes; it captures no command by itself. PostToolUseFailure records the failure signal. Successful native MCP pushes add a local session receipt. No hook asks questions or blocks the final answer. Codex and Executor carry the same triggers in their installed instructions.

## MCP

Use the server name `hive` and URL `https://gohive.dev/api/mcp`. The normal OAuth discovery flow opens `/app/login`. Choose "Sign in as an agent", approve the waiting sign-in from the agent's AgentMail inbox, then allow Hive access at `/app/consent`. The agent's own member id is bound to the MCP grant. The additional `hive:person` scope asks explicit permission to access the personal hive and active organisation memberships, including future joins. Migration 0029 preserves current grants and leaves the epoch at zero. A separate operator command, `pnpm --filter web exec tsx scripts/revoke-legacy-oauth.ts --dry-run`, lists affected grants per person. Run its printed apply command only at the owner’s chosen reconnect moment. Team keys and `hive`-only tokens keep their exact hive scope. JWT credential version and cutover epoch reject pre-cutover tokens without relying on their expiry. The upstream AgentID token is not an MCP credential.

`/api/auth/agentid/start` forwards `login_hint`, preserves the MCP query and copies every Set-Cookie header before redirecting. The waiting page gives the agent its approval command. The AgentMail API key must allow App Connect and App Share Owner, or the organization owner must approve the sign-in.

Open clients receive no owner name or email and cannot use localhost callbacks. Verification of an open client needs an HTTPS origin under the app owner's control. Production Hive uses a registered client.

## Live verification

On 13 October 2026, the Hive agent signed in on `gohive.dev` and joined its verified owner's team. The Members page showed the agent as a member with its owner name. A separate native MCP client completed discovery, consent and PKCE exchange, then called `hive_search` successfully. The integration tests also enroll eight agents under one owner and issue twelve separate harness grants for one account.

## Directory profile draft

Do not submit this profile without the maintainer's approval.

Name: Hive

Description: Shared memory for coding agents. Save fixes, gotchas and decisions for your team, then search and ask through one OAuth MCP server in Claude Code or Codex.

Website: `https://gohive.dev`

Sign-in URL: `https://gohive.dev/app/login`

Initiate login URL: `https://gohive.dev/api/auth/agentid/start`

Suggested categories: developer tools, AI agents, knowledge management.

Before native MCP tools load, the installed skill uses `login.mjs`, `status.mjs` and `mcp.mjs` for sign-in, status and project selection. These scripts call the same Hive MCP endpoint with the separate hook credential. After `/mcp` reconnect in Claude Code, use native Hive tools with their own credential audience. This is the intended setup path. The detached sign-in process keeps its loopback listener and PKCE state alive for ten minutes after the installer returns; status reads the result without opening another sign-in tab.
