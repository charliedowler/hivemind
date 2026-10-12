SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth_oauth_access_token)
     OR EXISTS (SELECT 1 FROM auth_oauth_refresh_token)
     OR EXISTS (SELECT 1 FROM auth_oauth_consent)
     OR EXISTS (SELECT 1 FROM auth_oauth_client) THEN
    RAISE EXCEPTION 'Preserve or explicitly retire OAuth grants before rolling back';
  END IF;
END $$;
DROP TABLE IF EXISTS auth_oauth_client_assertion;
DROP TABLE IF EXISTS auth_oauth_consent;
DROP TABLE IF EXISTS auth_oauth_access_token;
DROP TABLE IF EXISTS auth_oauth_refresh_token;
DROP TABLE IF EXISTS auth_oauth_client_resource;
DROP TABLE IF EXISTS auth_oauth_resource;
DROP TABLE IF EXISTS auth_oauth_client;
DROP TABLE IF EXISTS auth_jwks;
