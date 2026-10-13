SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE members ADD COLUMN provisional_expires_at timestamptz;
UPDATE members SET provisional_expires_at = created_at + interval '7 days' WHERE provisional;

CREATE TABLE agent_credentials (
  id text PRIMARY KEY,
  agent_member_id text NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  machine text NOT NULL,
  join_phrase text,
  join_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX agent_credentials_owner_idx ON agent_credentials(owner_member_id);

CREATE TABLE agent_connection_requests (
  id text PRIMARY KEY,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  polling_token_hash text NOT NULL UNIQUE,
  agent_name text NOT NULL,
  machine text NOT NULL,
  join_phrase text,
  agent_member_id text REFERENCES members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE VIEW hive_agent_owners AS
SELECT agent_member_id, owner_member_id FROM agent_credentials
UNION
SELECT a.user_id, b.owner_member_id FROM auth_accounts a
JOIN agent_owner_bindings b ON b.issuer = a.owner_issuer AND b.owner_sub = a.owner_sub
WHERE a.provider_id = 'agentid' AND a.owner_email_verified
UNION
SELECT a.user_id, b.owner_member_id FROM auth_accounts a
JOIN agent_owner_bindings b ON b.issuer = 'https://auth.agentid.com' AND b.owner_sub = a.owner_sub
WHERE a.provider_id = 'agentid' AND a.owner_email_verified AND a.owner_issuer IS NULL;

CREATE FUNCTION hive_guard_agent_credential() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.agent_member_id AND actor_type = 'agent' AND NOT provisional)
     OR NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.owner_member_id AND actor_type = 'human') THEN
    RAISE EXCEPTION 'Agent credentials need an agent and a human owner';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.agent_member_id, NEW.owner_member_id, NEW.token_hash) IS DISTINCT FROM (OLD.agent_member_id, OLD.owner_member_id, OLD.token_hash) THEN
    RAISE EXCEPTION 'Agent credential ownership is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hive_guard_agent_credential BEFORE INSERT OR UPDATE ON agent_credentials FOR EACH ROW EXECUTE FUNCTION hive_guard_agent_credential();

CREATE OR REPLACE FUNCTION hive_stamp_learning_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_member_id IS NULL THEN
    SELECT coalesce((SELECT owner_member_id FROM hive_agent_owners WHERE agent_member_id = NEW.member_id LIMIT 1), NEW.member_id) INTO NEW.owner_member_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE join_share_offers (
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  answered_at timestamptz,
  projects text[] NOT NULL DEFAULT '{}',
  human_instruction text,
  PRIMARY KEY(owner_member_id, team_id)
);
ALTER TABLE project_sharing_grants ADD COLUMN human_instruction text;
ALTER TABLE project_sharing_grants ADD COLUMN instructed_by text REFERENCES members(id);
