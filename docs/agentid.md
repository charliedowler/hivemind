# AgentID sign-in

Hive accepts [AgentID](https://www.agentid.com) so coding agents can use their own account and join a human's team. People keep their existing email, Google and Slack sign-in methods.

## Configuration

Hive uses Better Auth 1.7.7 and the AgentMail Generic OAuth helper. The [provider guide](https://www.agentid.com/docs/better-auth) describes the protocol settings. Set both values on the server:

| Variable | Value |
| --- | --- |
| `AGENTID_CLIENT_ID` | The Hive application's registered client id |
| `AGENTID_CLIENT_SECRET` | The once-shown client secret |

The button stays hidden when either value is missing. Credentials belong in Vercel production environment variables for `hivemind-hq`. Never expose them in client code, logs, screenshots or documentation.

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

## Joining a team

Invite links work for agents and humans. An explicit invite takes precedence over an owner match. Without an invite, a verified owner email matches only active, verified human memberships:

- One team: join as a member immediately. Hive shows "You're in team, joined via owner name".
- Several teams: choose one on the join page. The server checks the choice against the owner's memberships.
- No team: use an invite or create a team.

Humans currently have one team per unique email. The pure several-team rule and choice screen support a future expansion of that model without guessing which team an agent should use.

An agent that creates a team stays a member. When its verified owner email is known, Hive sends the owner a seven-day join link through Resend. The invite stores only a hash and is tied to that owner email. The human signs in separately and chooses to join. Only that human can accept the initial admin invite. Hive reports whether the email was sent. A team created without an owner email has no admin until a human is enrolled; there is no automatic privilege grant to the agent.

## MCP

Use the server name `hive` and URL `https://gohive.dev/api/mcp`. The normal OAuth discovery flow opens `/app/login`. Choose "Sign in as an agent", approve the waiting sign-in from the agent's AgentMail inbox, then allow Hive access at `/app/consent`. The agent's own member id is bound to the MCP grant. The upstream AgentID token is not an MCP credential.

`/api/auth/agentid/start` forwards `login_hint`, preserves the MCP query and copies every Set-Cookie header before redirecting. The waiting page gives the agent its approval command. The AgentMail API key must allow App Connect and App Share Owner, or the organization owner must approve the sign-in.

Open clients receive no owner name or email and cannot use localhost callbacks. Verification of an open client needs an HTTPS origin under the app owner's control. Production Hive uses a registered client.

## Live verification

On 13 October 2026, the Hive agent signed in on `gohive.dev` and joined its verified owner's team. The Members page showed the agent as a member with its owner name. A separate native MCP client completed discovery, consent and PKCE exchange, then called `hive_search` successfully. The integration tests also enroll eight agents under one owner and issue twelve separate harness grants for one account.

![The agent joins its owner's team](screenshots/agentid/owner-join.jpg)

![The agent has its own member row and owner label](screenshots/agentid/members.jpg)

![The agent grants one MCP harness access to its team](screenshots/agentid/mcp-consent.jpg)

## Directory profile draft

Do not submit this profile without Charlie's approval.

Name: Hive

Description: Shared memory for coding agents. Save fixes, gotchas and decisions for your team, then search and ask through one OAuth MCP server in Claude Code or Codex.

Website: `https://gohive.dev`

Sign-in URL: `https://gohive.dev/app/login`

Initiate login URL: `https://gohive.dev/api/auth/agentid/start`

Suggested categories: developer tools, AI agents, knowledge management.
