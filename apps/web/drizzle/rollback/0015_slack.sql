BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM slack_installations) OR EXISTS(SELECT 1 FROM slack_messages) OR EXISTS(SELECT 1 FROM slack_decisions) OR EXISTS(SELECT 1 FROM slack_ask_history) OR EXISTS(SELECT 1 FROM learnings WHERE source='slack') THEN
  RAISE EXCEPTION 'Refuse rollback of populated Slack knowledge. Export and disconnect installations first.';
 END IF;
END $$;
DROP TABLE IF EXISTS slack_decisions,slack_ask_history,slack_jobs,slack_actor_links,slack_messages,slack_channels,slack_oauth_states,slack_installations;
ALTER TABLE learnings DROP CONSTRAINT IF EXISTS learnings_source_check;
ALTER TABLE learnings ADD CONSTRAINT learnings_source_check CHECK(source IN ('claude-code','codex','manual'));
DELETE FROM _migrations WHERE name='0015_slack.sql';
COMMIT;
