DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM hive_join_requests) THEN RAISE EXCEPTION 'Join request history prevents rollback'; END IF;
END $$;
DROP TABLE hive_join_request_notifications;
DROP TABLE hive_join_requests;
DROP FUNCTION hive_validate_join_request();
