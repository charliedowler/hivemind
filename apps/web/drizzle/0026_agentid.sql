SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE members ADD COLUMN actor_type text NOT NULL DEFAULT 'human';
ALTER TABLE members ADD CONSTRAINT members_actor_type_check CHECK (actor_type IN ('human', 'agent'));
ALTER TABLE members ADD CONSTRAINT members_agent_role_check CHECK (actor_type <> 'agent' OR role = 'member');
ALTER TABLE auth_accounts ADD COLUMN owner_sub text;
ALTER TABLE auth_accounts ADD COLUMN owner_name text;
ALTER TABLE auth_accounts ADD COLUMN owner_email text;
ALTER TABLE auth_accounts ADD COLUMN owner_email_verified boolean NOT NULL DEFAULT false;

CREATE TABLE agent_owner_invites (
  team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  owner_email text NOT NULL,
  invite_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  delivered_at timestamptz,
  accepted_by text REFERENCES members(id) ON DELETE SET NULL
);
