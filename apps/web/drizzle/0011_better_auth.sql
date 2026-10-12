SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE members ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE members ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS hive_registration text;
ALTER TABLE members ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE web_sessions ALTER COLUMN team_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS web_sessions_token_idx ON web_sessions(token) WHERE token IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_sessions_member_fk' AND conrelid = 'web_sessions'::regclass) THEN
    ALTER TABLE web_sessions ADD CONSTRAINT web_sessions_member_fk FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_provider_idx ON auth_accounts(provider_id, account_id);
CREATE INDEX IF NOT EXISTS auth_accounts_user_idx ON auth_accounts(user_id);
CREATE TABLE IF NOT EXISTS auth_verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx ON auth_verification(identifier);
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count bigint NOT NULL,
  last_request bigint NOT NULL
);
