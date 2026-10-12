# Hive in Slack

Implementation plan, 12 October 2026. This plan waits for the identity, learnings backend and Better Auth rounds to finish. Read their reports and the final main branch before selecting migration numbers or changing service contracts.

## Ownership and order

Only this document is changed in the `docs/hive-slack` worktree while the three completion markers are absent. Check all three markers every 60 seconds for at most five hours. Once all exist, fast-forward main, read `/tmp/hive-r3/report.md`, `/tmp/hive-backend/report.md`, `/tmp/hive-auth/report.md` and `docs/learnings-backend.md`, then merge this plan. Implementation proceeds on main as requested. Children, if used, run on Codex only.

Use hand-written additive SQL through the repository migration runner. Write a matching rollback outside the forward migration directory. Inspect the SQL and exercise both directions against a disposable database before production. Apply the forward migration from the current main tip before pushing code that needs it. Never use schema push or force.

## What to borrow

Cloudy keeps one durable session per topic, acknowledges events before doing slow work, separates tools from orchestration and records delivery outcomes. Hive uses a durable thread and ask history, not Cloudy's managed-agent runtime. One answer belongs in the originating thread. Repeat delivery must not create repeat work or replies.

Wolf separates known facts, independent Jev questions and a pure `decide()` policy. Hive uses that shape. Bot messages and housekeeping cannot trigger replies. Explicit mentions, commands and DMs bypass the interjection classifier. Failures and uncertain judgments mean silence for unprompted messages. Do not add Wolf's Sonnet gate fallback. Existing Hive answer synthesis remains the product's configured service.

## Permission contract

- Only an active Hive team admin can connect, select, stop, purge or disconnect Slack. Re-check the role at the OAuth callback and at every settings write.
- Slack installation OAuth is separate from Sign in with Slack. Keep existing identity scopes and callback URLs. Installation uses OAuth v2 with bot scopes and its own callback.
- Bind a short-lived, single-use OAuth state to the initiating member, Hive team and browser session. Never accept a team identifier from callback query parameters.
- Encrypt each bot token at rest with authenticated encryption and a server-only key. Bind the ciphertext to the Hive team and Slack workspace. Do not return or log tokens. Refuse a workspace mapping that would silently attach the same workspace to a different Hive team.
- Invitation permits conversation. Indexing requires a separate admin selection of a public or private channel where the bot is currently a member. Newly discovered channels are off by default.
- Never index DMs or group DMs. DM ask history remains conversation state and is isolated by the requesting Slack actor; it does not enter search, citations or the comb.
- Re-check installation and channel consent before fetching history, storing a message, returning a search hit or citing one. Keep `enabled`, `paused` and `purged` states distinct: enabled permits ingestion and search; paused permits existing search only; purged permits neither. Stop changes enabled to paused and cancels ingestion jobs. Purge removes stored text, embeddings and pending message payloads for the channel and advances the permission generation. A concurrent worker cannot put a purged message back. Loss of bot membership suspends both ingestion and retrieval.
- Slack email links only to an active, verified member of this Hive team. A name is never identity proof. Unknown authors display as `Slack teammate`. A reaction cannot impersonate the installing admin. An unlinked reactor receives a clear join instruction rather than an attributed member learning.
- A mention or command from an unlinked Slack actor must not use an admin context. Resolve an authenticated installation context and enforce the audience boundary explicitly. Do not expose private-channel citations into a public channel or to an actor who cannot read their source. Define and test this boundary against the final auth and backend contracts before implementation.

## Data and service boundaries

Add team-scoped tables for installations, channel consent and backfill progress, Slack actor links, indexed messages, thread ask history, event/job receipts, interjection decisions and reply reservations. Prefer the final backend's queue or audit primitives when available.

`slack_messages` holds id, team, workspace, channel, Slack timestamp, root thread timestamp, redacted text, author id and display label, permalink, created/edited time, generated FTS and nullable 1536-dimensional embedding. Uniqueness is scoped to team, channel and message timestamp. Every read, update and delete filters the authenticated team. Indexes support team/channel/time, FTS and vector retrieval. Store Slack timestamps as text without floating-point conversion.

Slack messages are evidence, not confirmed cells. Reuse hybrid ranking from core and apply an explicit source weight below confirmed learnings. Preserve `source: slack`, channel, thread and permalink through search, synthesis, MCP output and UI. Validate cited ids against authorized retrieved evidence. A saved Slack learning retains its origin permalink and actual saver while using Hive's existing redaction, dedupe and Jev push classification.

Keep Slack HTTP/API access in a small client with response validation, request deadlines, cursor pagination and typed rate-limit errors. Verify each method against current official docs. Honor `Retry-After`; schedule a retry instead of sleeping inside a webhook. Bounds limit work per invocation, not silently truncate the whole channel. Save cursors and expose progress and errors.

## Routes and durable work

1. Add signed POST `/api/slack/events` with Slack URL verification. Validate the raw body, timestamp and HMAC with constant-time comparison. Reject stale or forged requests. This endpoint ships before app configuration changes.
2. Signed events persist an idempotent work receipt and publish a small job reference to a durable queue before acknowledging. Prefer Vercel Queues with a private callback and bounded concurrency; it is available on Hobby with an included operation allowance. Retain database progress, leases and permission generations. Delayed continuation handles Slack rate limits and backfill cursors. Next.js `after()` alone is not durable across request termination, and Hobby cron only runs daily. No in-memory timers or fire-and-forget promises as the only execution mechanism. Do not upgrade the hosting plan or buy capacity.
3. Add installation start/callback routes under `/api/slack/oauth`, signed `/api/slack/commands` and `/api/slack/interactivity`. Origin-check cookie-authenticated settings mutations.
4. Deduplicate overlapping `app_mention` and message deliveries by workspace/channel/message, not just event id. Claim send work before calling Slack. Record posted timestamp and failures. Serialize thread turns so a follow-up sees the preceding answer.
5. Handle ordinary messages, edits and deletes. Ignore the Hive bot and other bots for interjections and learnings. A delete removes indexed evidence; an edit refreshes text and embedding. Handle revoked installations and unavailable channels conservatively.

## Slack conversation

`@Hive <question>` and DMs call the existing `askHive` service. Read bounded thread history and prior asks; pass context as untrusted conversation data, never as permissions. Keep citation ids, confidence and gaps. Format permitted citations as Slack links: dashboard links for cells, message permalinks for Slack evidence. Escape Slack markup and neutralize unintended mentions. Enforce Hive's warm, plain voice, sentence case, no emoji in text and no exclamation marks.

`/hive ask <question>` and `/hive recent` share those services. Slack slash commands do not reliably carry the current thread or replied-to message. Support `/hive save <message permalink>` and a message shortcut for exact selection; a bare `/hive save` must offer that selection path rather than guess the latest channel message. Save a bounded thread with a visible summary and original source. Mark incomplete thread reads explicitly.

A `bee` reaction saves the selected message through `pushLearning`, attributed to the verified reacting member. Fetch the exact channel and timestamp, validate source visibility, deduplicate repeat reactions and never save a DM. Bot reactions do not create learnings. Use a non-bee acknowledgement reaction for `react_only`, so Hive cannot trigger its own save handler.

## Jev interjections

Retrieve confirmed, current cells first. Confirmed means the backend's status rule, currently multiple pushes or an upvote, with no outdated status. Slack evidence alone never permits an unsolicited reply.

Ask independent Noul questions over bounded thread context and candidate cells: addressed to Hive, asks a question the confirmed evidence directly answers, people talking to each other, already answered, more coming and acknowledgement of Hive. Store the probabilities, policy version, model, latency, candidate ids, reason and delivery outcome in the decision log. Do not log raw message text or secrets in application logs.

The pure policy returns `reply_now`, `react_only` or `stay_silent`. A high human-conversation, already-answered or incomplete-message signal vetoes an unprompted post. An explicit mention always receives an answer or an honest gap. A thread already holding a Hive conversation can answer a clear follow-up. Other unprompted replies require a close match to a confirmed cell and high answerability, at most one unprompted post per thread and a default cap of two per channel per hour. Enforce caps with database reservations in one transaction, including concurrent events. Rate caps never suppress explicit requests. Re-check source consent and thread freshness before posting.

## Dashboard

Add `/app/settings/slack` using the existing Hive design system. Disconnected state shows `Connect Slack`. Connected state shows the workspace, exactly which invited channels are indexed, public/private labels, indexed counts, backfill state and errors. Channels have independent enable, stop and purge controls. Explain that stop keeps existing evidence and purge removes it. Provide disconnect with a clear data consequence.

Add a decision log with time, channel/thread link, decision, reason, Jev probabilities, evidence links and delivery state. Empty, loading, unavailable, expired-installation and permission-denied states remain usable at 390 pixels. Mark Slack-sourced comb items and ask citations visibly and link to the original message. Keep durable learnings and raw indexed messages distinct in the data contract.

## Manifest and rollout

Record the existing app configuration before edits. Preserve Sign in with Slack. Add bot user, bot scopes `app_mentions:read`, `channels:history`, `groups:history`, `im:history`, `channels:read`, `groups:read`, `chat:write`, `reactions:read`, `reactions:write`, `users:read`, `users:read.email`, `commands`, `pins:read`; events `app_mention`, `message.channels`, `message.groups`, `message.im`, `reaction_added`; `/hive`; interactivity and a save-message shortcut. Add installation callback. All request URLs use `https://gohive.dev`.

Deploy URL verification first. Use Charlie's Chrome to update app `A0C8P4V5L82`, verify the URL and reinstall through the Hive admin's Connect Slack flow. Record exact changes and delivery URLs in `~/projects/launchathon-infra/hivemind.md`. Do not print client secrets or tokens. Confirm Slack's granted scopes after installation.

## Verification and report

Run `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter web build`. Add meaningful gate and delivery tests, signature and OAuth replay tests, consent revocation/purge races, DM exclusion, private-source audience boundaries, cross-team search/read/update/delete, citation formatting and bee-reaction attribution/idempotency. Run React Doctor on changed React files and fix diagnostics caused by this change.

Live checks use an existing launchathon or Wolf test channel, or Charlie's chosen test channel. Connect Slack for the intended Hive team, invite Hive, enable indexing only for that test channel and verify: cited mention answer, human chit-chat remains silent with logged decisions, bee reaction produces the attributed cell, `/hive ask` works, and this Mac's registered Hive MCP returns a Slack citation. Include a thread follow-up and a purge check. Never substitute direct calls to the gate for real Slack exchanges.

Capture settings and decision log at 1280 and 390 into `docs/screenshots` and inspect every image. Update README and SPEC with actual behavior and limitations. Write and print `/tmp/hive-slack/report.md` with commit ids, migration and rollback, manifest changes, permission rules, three real exchanges with decision evidence, screenshot paths, test results, production checks, stubs and remaining human steps. No claimed live result without the exchange and stored evidence.

## Current read status

Read Hive's README, SPEC, current auth/MCP service, migration runner and design-system voice. Read Cloudy's session, tool and voice structure. Read Wolf's `origin/main` gate policy, questions, model and orchestration, plus its when-to-chime-in design. `docs/learnings-backend.md` is absent in the planning snapshot and must be read after the backend marker. Re-read auth and MCP after the auth marker.

Official contracts consulted: [Slack OAuth](https://docs.slack.dev/authentication/installing-with-oauth/), [Events API](https://docs.slack.dev/apis/events-api/), [history](https://docs.slack.dev/reference/methods/conversations.history/), [thread replies](https://docs.slack.dev/reference/methods/conversations.replies/), [OAuth exchange](https://docs.slack.dev/reference/methods/oauth.v2.access/), [TypeSafe index](https://docs.typesafe.ai/llms.txt), [Vercel Queues quickstart](https://vercel.com/docs/queues/quickstart), [queue pricing and limits](https://vercel.com/docs/queues/pricing), [Hobby cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). Current history and replies docs distinguish internal apps from non-Marketplace commercial installs; the client must handle the lower limit and persistent continuation.
