SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM members WHERE team_id IS NULL) THEN
    RAISE EXCEPTION 'Finish or explicitly retire pending accounts before rolling back';
  END IF;
END $$;
DELETE FROM web_sessions WHERE token IS NOT NULL;
DROP TABLE IF EXISTS auth_rate_limit;
DROP TABLE IF EXISTS auth_verification;
DROP TABLE IF EXISTS auth_accounts;
ALTER TABLE web_sessions DROP CONSTRAINT IF EXISTS web_sessions_member_fk;
ALTER TABLE web_sessions DROP COLUMN IF EXISTS token;
ALTER TABLE web_sessions DROP COLUMN IF EXISTS updated_at;
ALTER TABLE web_sessions DROP COLUMN IF EXISTS ip_address;
ALTER TABLE web_sessions DROP COLUMN IF EXISTS user_agent;
ALTER TABLE web_sessions ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE members DROP COLUMN IF EXISTS updated_at;
ALTER TABLE members DROP COLUMN IF EXISTS image;
ALTER TABLE members DROP COLUMN IF EXISTS hive_registration;
ALTER TABLE members ALTER COLUMN team_id SET NOT NULL;
