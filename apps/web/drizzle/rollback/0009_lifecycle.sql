BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE learnings, learning_versions, learning_supersessions IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM learning_supersessions) OR EXISTS (SELECT 1 FROM learning_versions WHERE revision > 1) OR EXISTS (SELECT 1 FROM learnings WHERE lifecycle IN ('superseded', 'retracted')) THEN
    RAISE EXCEPTION 'Export and preserve lifecycle history before rollback';
  END IF;
END $$;
DROP TRIGGER IF EXISTS hive_record_learning_version ON learnings;
DROP TRIGGER IF EXISTS hive_prepare_learning_version ON learnings;
DROP FUNCTION IF EXISTS hive_record_learning_version();
DROP FUNCTION IF EXISTS hive_prepare_learning_version();
DROP FUNCTION IF EXISTS hive_learning_content(learnings);
DROP TABLE IF EXISTS learning_conflict_votes;
DROP TABLE IF EXISTS learning_supersessions;
DROP TABLE IF EXISTS learning_versions;
DROP INDEX IF EXISTS learnings_team_lifecycle_idx;
ALTER TABLE learnings DROP CONSTRAINT IF EXISTS learnings_successor_team_fk;
ALTER TABLE learnings DROP COLUMN IF EXISTS superseded_by;
ALTER TABLE learnings DROP COLUMN IF EXISTS revision;
ALTER TABLE learnings DROP COLUMN IF EXISTS verify_after;
ALTER TABLE learnings DROP COLUMN IF EXISTS lifecycle;
DELETE FROM _migrations WHERE name = '0009_lifecycle.sql';
COMMIT;
