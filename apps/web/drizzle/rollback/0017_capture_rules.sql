BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE capture_rules, capture_rule_previews, capture_rule_applications, learnings IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM capture_rules) OR EXISTS (SELECT 1 FROM capture_rule_applications) OR EXISTS (SELECT 1 FROM learnings WHERE capture_flagged OR capture_redacted OR cardinality(capture_rule_ids) > 0 OR capture_categories <> '{}'::jsonb OR capture_context <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Export and preserve capture rules and privacy history before rollback';
  END IF;
END $$;
DROP TABLE IF EXISTS capture_rule_applications;
DROP TABLE IF EXISTS capture_rule_previews;
DROP TABLE IF EXISTS capture_rules;
DROP INDEX IF EXISTS learnings_capture_visibility_idx;
ALTER TABLE learnings DROP COLUMN IF EXISTS capture_context;
ALTER TABLE learnings DROP COLUMN IF EXISTS capture_categories;
ALTER TABLE learnings DROP COLUMN IF EXISTS capture_flagged;
ALTER TABLE learnings DROP COLUMN IF EXISTS capture_redacted;
ALTER TABLE learnings DROP COLUMN IF EXISTS capture_rule_ids;
DELETE FROM _migrations WHERE name = '0017_capture_rules.sql';
COMMIT;
