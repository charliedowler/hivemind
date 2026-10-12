SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS classification jsonb;
ALTER TABLE learning_pushes ADD COLUMN IF NOT EXISTS classification jsonb;
ALTER TABLE ask_log ADD COLUMN IF NOT EXISTS classification jsonb;
