SET lock_timeout = '5s';
SET statement_timeout = '30s';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM slack_digest_instructions) THEN
  RAISE EXCEPTION 'Digest instruction history exists; rollback refused';
 END IF;
END $$;
DROP INDEX IF EXISTS slack_digest_instruction_decisions;
DROP TABLE IF EXISTS slack_digest_instructions;
ALTER TABLE slack_digest_schedules DROP COLUMN IF EXISTS instruction_revision;
