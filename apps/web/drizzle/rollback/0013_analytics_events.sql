BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE analytics_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM analytics_events) THEN
    RAISE EXCEPTION 'Retain or archive analytics history before schema rollback';
  END IF;
END $$;
DROP TABLE analytics_events;
DROP FUNCTION hive_analytics_immutable();
DELETE FROM _migrations WHERE name = '0013_analytics_events.sql';
COMMIT;
