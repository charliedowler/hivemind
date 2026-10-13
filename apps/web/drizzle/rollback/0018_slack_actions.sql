SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM slack_tool_actions WHERE undone_at IS NULL AND expires_at > now()) THEN
  RAISE EXCEPTION 'Live undo receipts exist. Keep the undo table until they expire or are reversed.';
 END IF;
END $$;
DROP TABLE slack_tool_actions;
DELETE FROM _migrations WHERE name = '0018_slack_actions.sql';
