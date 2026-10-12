BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings DROP COLUMN IF EXISTS classification;
ALTER TABLE learning_pushes DROP COLUMN IF EXISTS classification;
ALTER TABLE ask_log DROP COLUMN IF EXISTS classification;
DELETE FROM _migrations WHERE name = '0008_classification.sql';
COMMIT;
