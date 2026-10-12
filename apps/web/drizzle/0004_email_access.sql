SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE members ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
ALTER TABLE members ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS members_email_idx ON members (email) WHERE email IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_email_check' AND conrelid = 'members'::regclass) THEN
    ALTER TABLE members ADD CONSTRAINT members_email_check CHECK (email IS NULL OR email = lower(email));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_role_check' AND conrelid = 'members'::regclass) THEN
    ALTER TABLE members ADD CONSTRAINT members_role_check CHECK (role IN ('member', 'admin'));
  END IF;
END $$;
UPDATE members m SET role = 'admin' WHERE m.id = (SELECT id FROM members WHERE team_id = m.team_id ORDER BY created_at, id LIMIT 1);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days';
UPDATE teams SET invite_code = encode(sha256(convert_to(invite_code, 'UTF8')), 'hex') WHERE length(invite_code) <> 64;
CREATE TABLE IF NOT EXISTS team_domains (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  domain text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, domain)
);
CREATE TABLE IF NOT EXISTS email_verifications (
  id text PRIMARY KEY,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  code_hash text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  delivered boolean NOT NULL DEFAULT false,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_email_idx ON email_verifications (email, created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
