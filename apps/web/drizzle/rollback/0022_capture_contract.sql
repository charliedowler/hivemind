BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM learnings WHERE blocked IS NULL) OR EXISTS (SELECT 1 FROM learning_pushes WHERE blocked IS NULL OR capture_key IS NOT NULL OR is_correction) OR EXISTS (SELECT 1 FROM learning_versions WHERE content->'blocked' = 'null'::jsonb) THEN
    RAISE EXCEPTION 'Export and preserve unknown friction and capture receipts before rollback';
  END IF;
END $$;
DROP INDEX IF EXISTS learning_pushes_capture_key_idx;
ALTER TABLE learning_pushes DROP COLUMN IF EXISTS capture_key;
ALTER TABLE learning_pushes DROP COLUMN IF EXISTS is_correction;
ALTER TABLE learnings ALTER COLUMN blocked SET NOT NULL;
ALTER TABLE learnings ALTER COLUMN blocked SET DEFAULT false;
ALTER TABLE learning_pushes ALTER COLUMN blocked SET NOT NULL;
ALTER TABLE learning_pushes ALTER COLUMN blocked SET DEFAULT false;
DELETE FROM _migrations WHERE name = '0022_capture_contract.sql';
COMMIT;
