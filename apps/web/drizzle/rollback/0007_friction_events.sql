BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learning_pushes DROP COLUMN IF EXISTS blocked;
DELETE FROM _migrations WHERE name = '0007_friction_events.sql';
COMMIT;
