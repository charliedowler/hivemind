BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE capture_rule_instructions, capture_rule_applications IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM capture_rule_instructions) OR EXISTS (SELECT 1 FROM capture_rule_applications WHERE instruction_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Export and preserve capture instruction audits and undo history before rollback';
  END IF;
END $$;
DROP INDEX IF EXISTS capture_rule_applications_instruction_idx;
ALTER TABLE capture_rule_applications DROP COLUMN IF EXISTS instruction_id;
DROP TABLE IF EXISTS capture_rule_instructions;
DELETE FROM _migrations WHERE name ~ '^[0-9]+_capture_rule_instructions\.sql$';
COMMIT;
