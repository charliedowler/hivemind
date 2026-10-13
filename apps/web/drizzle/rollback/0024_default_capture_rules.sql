SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM capture_rules WHERE id LIKE 'crule_default_%') THEN
    RAISE EXCEPTION 'Default exclusions exist; rollback refused to weaken team privacy';
  END IF;
END $$;
DROP FUNCTION IF EXISTS hive_create_default_capture_rules(text, text);
