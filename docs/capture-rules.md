# What Hive keeps

Members choose which observations their agents may save at `/settings/capture`. Admins can also set rules for the whole team. Team rules and the member's own rules apply to each capture. A member cannot change another member's rules or weaken a team rule.

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

Hive evaluates repo, path, agent and keyword rules first. It asks the content classifier only when an effective content rule needs a decision. A low-confidence or unavailable fast classifier uses the server's model fallback. A stored cell caches the category decision. Rules cannot make the existing secret redaction less strict.

## Actions and privacy

`drop` excludes the observation before a cell, evidence record or embedding is written. `hive_push` returns `{ dropped: true, rule: <kind> }`. Agents carry on silently. The analytics event includes the rule ID and kind, never the dropped content.

`redact` replaces matched text with `[removed]` and marks the cell as redacted. A metadata rule that matches the whole observation removes its title and body. Hive does not put the original matched text into shared evidence or the generated tree.

`flag` keeps the cell for its owner to review. Other members cannot see it in search, answers, Slack replies, history or exports. Shared tree materialisation excludes flagged cells. The owner confirms the cell before it becomes shared.

A matching drop takes precedence over other actions. Redaction and flagging can apply together. All reads still require current team membership.

## Describe a rule

Describe what Hive should keep in settings or through `hive_set_capture_rule` in Slack. A clear, specific instruction saves the rule immediately. Hive restates the result in one line. There is no proposal or confirmation step. The web description field also accepts undo.

A pure decision checks whether the text is an instruction, whether it identifies the required matches and whether the requested scope is allowed. It has a 500 ms timeout. When this decision is unavailable, the schema model's own judgement provides the fallback. Current database membership and the admin role still control team rules. A model cannot grant permission.

Hive asks one question when a required detail is missing. Known repo metadata helps identify work organisations. Several possible organisations can require a question about which owners to keep. Questions and tentative suggestions do not create rules.

Description-based drop and redact rules apply to existing memories automatically. A member's flag rule applies to future captures. Team rules also apply across the team's existing memories. The reply reports the recorded counts. The decision and automatic actions are audited. Within one hour, the same caller can reply undo to remove the new rule and reverse its recorded changes, subject to revision and privacy guards. Undoing a team rule requires a current admin.

Large scans continue in bounded batches. Replies distinguish completed updates from pending work. A changed rule or lost permission can stop a scan; the reply identifies stopped work. A persisted cursor and counts support recovery through `/api/cron/capture-rules` every 15 minutes. Undo also resumes safely if its reversal needs several batches.

## Slack

Ask Hive to set a capture rule in a thread or a direct message. A clear instruction saves directly without a button. Reply undo in the same thread or direct-message conversation within one hour. Undo checks the current caller, team and conversation context.

Channel replies describe the action, match type and scope without quoting private names, paths or patterns. Direct messages can show the exact escaped restatement. Ask which capture rules apply to you to use `hive_list_capture_rules`. It lists enabled team rules and your own enabled rules, and excludes other members' personal rules.

## Existing cells

The structured editor offers a bounded preview before manual application. Description-based rules use the same guarded batches automatically. The preview includes learnings, insights and friction. Drop rules retract matching cells through the existing lifecycle with reason `capture_rule` and the rule ID. Redact and flag rules use the same actions as new captures. The history records the action and count, and an admin can reverse it through Applied history in capture settings.

A preview checks at most 500 cells for a cheap rule or eight cells for a content rule. The smaller content batch bounds model work within the request. If more cells remain, Preview next batch advances the cursor, including batches with no matches. A changed rule or cell needs a new preview. Snapshot links issued before an applied privacy action are revoked and cannot be used to bypass a later privacy action.

## Hooks

The packaged hook fetches `GET /api/app/capture-rules/effective` with its OAuth token or member key. A local cache lasts 30 seconds and is bound to the endpoint and credential. It contains rules, never captured text. The hook skips sending an observation when a cheap drop rule matches its repo, remote, path, agent, session type or summary keywords. It uses the matcher from `packages/core`, packaged with the CLI.

Content rules stay on the server. The server checks every ingress even when local filtering succeeds or the cache is stale. A standalone Stop snippet uses the installed hook module when present; server enforcement remains active without that module. Quiet sessions keep their existing local pre-gate.

Hooks send working directory, remote URL, repo name, branch, agent and session metadata with the bounded capture summary. These fields are for rule evaluation, not generic analytics. Capture analytics contain fixed rule/action/ingress/agent metadata only.

## Operations

Apply the reviewed SQL migration through `pnpm --filter web db:migrate` from the merged landing commit before deploying code that uses capture rules. The migration and rollback set lock and statement timeouts. The rollback preserves recorded privacy history rather than silently discarding it. Never use schema push for this change.
