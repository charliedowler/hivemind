# What Hive keeps

Team admins choose what Hive leaves out on the Team page. Account can show the member's own exclusions through the same component in personal mode. The capture settings route redirects to Team until its removal. Team exclusions and the member's own exclusions apply together. A member cannot change another member's exclusions or weaken a team exclusion.

Every new team starts with three enabled content exclusions: credentials, personal data and customer data. These use the existing `credentials`, `personal_info` and `customer_data` categories and the `drop` action. Each switch excludes that content when on. Only team admins can change it. Turning a switch off affects future captures; earlier changes to cells stay as they are. The default IDs are stable for each team. The backfill adds any missing defaults without duplicating them or overwriting a saved choice.

Describe something Hive should not keep in one sentence, then select Save. A complete instruction takes effect immediately. Hive shows one highlighted line and Undo. The list below uses plain words, with enable and delete controls. Deletion also offers Undo, which restores the exclusion for future captures and leaves earlier cell changes alone. Team mode saves for every member; personal mode saves for the caller's agents only.

## Rules

Each rule belongs to a team and has a member or team scope, a typed configuration, an action, an enabled state and its source. Hive keeps the person's original description, the creator and creation time. Disabling a rule affects later captures. Deleting it does not undo earlier actions.

| Kind | Match |
| --- | --- |
| `repo_owner` | A list of repository owners or organisations. `deny` excludes these owners. `only_allow` excludes owners outside the list. |
| `repo_match` | A glob against the remote URL or `owner/repo` name. |
| `path_match` | A glob against the working directory or supplied paths. `~/` matches the caller's home directory. |
| `agent_or_client` | The agent or hook session type. |
| `keyword` | Case-insensitive terms or a bounded, restricted regular expression against title and body. |
| `content_category` | Personal information, credentials, customer data or non-work activity. |

Hive runs a deterministic local privacy gate before capture classification or storage. It checks the observation, evidence and context even when content exclusions are off. It refuses personal facts, customer identifiers and records, known customer names from customer exclusions, and captures whose only fact is a secret. Credential assignments, bearer values, private keys, connection passwords and cookies are removed when a useful technical fact remains. A refusal returns one line without the submitted text: "This observation may contain a secret or personal data. Remove identifying details before sharing it." The structured refusal event contains only a category and a fixed reason.

Hive then evaluates repo, path, agent and keyword rules. It asks the content classifier only when an effective content rule needs a decision. A low-confidence or unavailable fast classifier uses the server's model fallback. A stored cell caches the category decision. Rules cannot make the existing secret redaction less strict.

## Actions and privacy

`drop` excludes the observation before a cell, evidence record or embedding is written. `hive_push` returns `{ dropped: true, rule: <kind> }`. Agents carry on silently. The analytics event includes the rule ID and kind, never the dropped content.

`redact` replaces matched text with `[removed]` and marks the cell as redacted. A metadata rule that matches the whole observation removes its title and body. Hive does not put the original matched text into shared evidence or the generated tree.

`flag` keeps the cell for its owner to review. Other members cannot see it in search, answers, Slack replies, history or exports. Shared tree materialisation excludes flagged cells. The owner confirms the cell before it becomes shared.

A matching drop takes precedence over other actions. Redaction and flagging can apply together. All reads still require current team membership.

## Save an exclusion

Describe what Hive should not keep on Team or Account or through `hive_set_capture_rule` in Slack. A clear, specific instruction saves the rule immediately. Hive restates the result in one line. There is no proposal or confirmation step. The web description field also accepts undo.

A pure decision checks whether the text is an instruction, whether it identifies the required matches and whether the requested scope is allowed. It has a 500 ms timeout. When this decision is unavailable, the schema model's own judgement provides the fallback. Current database membership and the admin role still control team rules. A model cannot grant permission.

Hive asks one question when a required detail is missing. Known repo metadata helps identify work organisations. Several possible organisations can require a question about which owners to keep. Questions and tentative suggestions do not create rules.

Description-based drop and redact rules apply to existing memories automatically. A member's flag rule applies to future captures. Team rules also apply across the team's existing memories. The reply reports the recorded counts. The decision and automatic actions are audited. Within one hour, the same caller can reply undo to remove the new rule and reverse its recorded changes, subject to revision and privacy guards. Undoing a team rule requires a current admin.

Large scans continue in bounded batches. Replies distinguish completed updates from pending work. A changed rule or lost permission can stop a scan; the reply identifies stopped work. A persisted cursor and counts support recovery through `/api/cron/capture-rules` every 15 minutes. Undo also resumes safely if its reversal needs several batches.

## Slack

Ask Hive to set a capture rule in a thread or a direct message. A clear instruction saves directly without a button. A clean save with no earlier memories changed receives a white check reaction and no post. Hive posts one line when it has a changed-memory count, unfinished work or a required-detail question. Replies contain readable times and no control hints. Undo remains a plain-language command in the same conversation within one hour.

A generic Slack action row points to the capture instruction and commits in the same transaction. Plain-thread undo dispatches by tool name to the capture service. The private capture audit controls the caller, scope, one-hour window and revision-safe reversal. A repeated Slack event uses the existing pointer rather than creating another rule.

Channel replies describe the action, match type and scope without quoting private names, paths or patterns. Direct messages can show the exact escaped restatement. Ask which capture rules apply to you to use `hive_list_capture_rules`. It lists enabled team rules and your own enabled rules, and excludes other members' personal rules.

## Existing cells

Sentence-based drop and redact exclusions also update existing memories automatically. Team exclusions check the whole team's existing memories. A member's private-until-confirmed exclusion applies to future captures. The instruction worker scans at most 100 cells per batch, or eight for a content category. Empty batches advance the cursor. It uses an in-memory batch, with no stored preview token or separate human action.

The worker rechecks membership, ownership, the saved revision and the cursor before each change. It skips cells edited after the scan. Drop retracts matching cells and keeps their content private. Redaction removes matching content from shared history and sidecars. Flagging keeps a cell private to its owner. Snapshot links issued before an applied privacy action are revoked. The action history remains private audit data; it has no web editor or reversal form. Undo uses the instruction's audited changes and preserves later edits and other exclusions.

This automatic path already supports an instruction to remove matching existing cells. It also runs for complete drop or redact descriptions that do not explicitly mention older cells. The three default switches do not trigger a historical scan.

## Hooks

The packaged hook fetches `GET /api/app/capture-rules/effective` with its OAuth token or member key. A local cache lasts 30 seconds and is bound to the endpoint and credential. It contains rules, never captured text. The hook skips sending an observation when a cheap drop rule matches its repo, remote, path, agent, session type or summary keywords. It uses the matcher from `packages/core`, packaged with the CLI.

The hook and server share the pure privacy gate in `packages/core/src/capture-privacy.mjs`. The hook checks candidate text before upload and uses the sanitized text for both the Stop summary and `hive_push`. The category classifier remains on the server and receives only text that passes the local gate. Pattern matching is conservative; it does not establish that arbitrary prose is free of sensitive information. Content rules provide the second check on text that passes. The server checks every ingress even when local filtering succeeds or the cache is stale. A standalone Stop snippet uses the installed hook module when present; server enforcement remains active without that module. Quiet sessions keep their existing local pre-gate.

Hooks send working directory, remote URL, repo name, branch, agent and session metadata with the bounded capture summary. These fields are for rule evaluation, not generic analytics. Capture analytics contain fixed rule/action/ingress/agent metadata only.

## Operations

Migration `0024_default_capture_rules.sql` creates the idempotent default helper and backfills existing teams. Enrollment calls the helper in the same transaction as new team membership. The rollback refuses to remove the helper while default exclusions remain, so it cannot silently weaken privacy. No table is dropped. Apply reviewed SQL migrations through `pnpm --filter web db:migrate` from the merged landing commit before deploying code that uses capture rules. The migration and rollback set lock and statement timeouts. The rollback preserves recorded privacy history rather than silently discarding it. Never use schema push for this change.
