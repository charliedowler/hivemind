SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS admin_outdated boolean NOT NULL DEFAULT false;
