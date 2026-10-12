SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings DROP COLUMN IF EXISTS admin_outdated;
DELETE FROM _migrations WHERE name = '0005_moderation.sql';
