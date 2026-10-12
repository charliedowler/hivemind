SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learning_pushes ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
