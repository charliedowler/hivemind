SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings ALTER COLUMN blocked DROP NOT NULL;
ALTER TABLE learnings ALTER COLUMN blocked DROP DEFAULT;
ALTER TABLE learning_pushes ALTER COLUMN blocked DROP NOT NULL;
ALTER TABLE learning_pushes ALTER COLUMN blocked DROP DEFAULT;
ALTER TABLE learning_pushes ADD COLUMN IF NOT EXISTS capture_key text;
ALTER TABLE learning_pushes ADD COLUMN IF NOT EXISTS is_correction boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS learning_pushes_capture_key_idx ON learning_pushes(team_id, member_id, capture_key) WHERE capture_key IS NOT NULL;
