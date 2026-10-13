SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE auth_accounts ADD COLUMN IF NOT EXISTS owner_issuer text CHECK (owner_issuer = 'https://auth.agentid.com');
UPDATE auth_accounts SET owner_issuer = 'https://auth.agentid.com' WHERE provider_id = 'agentid' AND owner_sub IS NOT NULL AND owner_issuer IS NULL;
ALTER TABLE members ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS provisional boolean NOT NULL DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS personal_owner_member_id text REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_paused boolean NOT NULL DEFAULT true;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_domain_policy text NOT NULL DEFAULT 'verified_domain' CHECK (join_domain_policy = 'verified_domain');
ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_generation integer NOT NULL DEFAULT 0 CHECK (join_generation >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS teams_personal_owner_idx ON teams(personal_owner_member_id) WHERE personal_owner_member_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hive_memberships (
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  owner_member_id text REFERENCES members(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (member_id, team_id),
  UNIQUE (team_id, member_id)
);
CREATE INDEX IF NOT EXISTS hive_memberships_active_owner_idx ON hive_memberships(owner_member_id, team_id) WHERE removed_at IS NULL;
INSERT INTO hive_memberships (member_id, team_id, role, joined_at, removed_at)
SELECT id, team_id, role, created_at, removed_at FROM members WHERE team_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_owner_bindings (
  issuer text NOT NULL CHECK (issuer = 'https://auth.agentid.com'),
  owner_sub text NOT NULL,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  verified_contact_email text NOT NULL CHECK (verified_contact_email = lower(verified_contact_email)),
  verified_contact_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS agent_owner_bindings_member_idx ON agent_owner_bindings(owner_member_id);
INSERT INTO agent_owner_bindings (issuer, owner_sub, owner_member_id, verified_contact_email, verified_contact_name)
SELECT DISTINCT ON (a.owner_sub) 'https://auth.agentid.com', a.owner_sub, m.id, a.owner_email, a.owner_name
FROM auth_accounts a JOIN members m ON m.email = a.owner_email
WHERE a.provider_id = 'agentid' AND a.owner_sub IS NOT NULL AND a.owner_email_verified AND m.actor_type = 'human' AND m.email_verified AND m.disabled_at IS NULL
ORDER BY a.owner_sub, a.created_at, a.id
ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM auth_accounts a JOIN agent_owner_bindings b ON b.owner_sub = a.owner_sub
    WHERE a.provider_id = 'agentid' AND a.owner_email_verified AND a.owner_email IS DISTINCT FROM b.verified_contact_email
  ) THEN RAISE EXCEPTION 'Conflicting verified owner claims'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS hive_join_phrases (
  phrase text PRIMARY KEY CHECK (phrase ~ '^[a-z]+-[a-z]+-[a-z]+$'),
  team_id text NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  generation integer NOT NULL CHECK (generation > 0),
  created_by text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (team_id, generation)
);
CREATE UNIQUE INDEX IF NOT EXISTS hive_join_phrases_active_idx ON hive_join_phrases(team_id) WHERE retired_at IS NULL;
CREATE TABLE IF NOT EXISTS hive_join_capabilities (
  token_hash text PRIMARY KEY,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  agent_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hive_identity_legacy_constraints (
  table_name text NOT NULL,
  constraint_name text NOT NULL,
  definition text NOT NULL,
  PRIMARY KEY (table_name, constraint_name)
);
DO $$ DECLARE item record; BEGIN
  FOR item IN
    SELECT c.conrelid::regclass AS relation, c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = 'members'::regclass AND cardinality(c.confkey) = 2
  LOOP
    INSERT INTO hive_identity_legacy_constraints VALUES (item.relation::text, item.conname, item.definition) ON CONFLICT DO NOTHING;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.relation, item.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.relation, item.conname,
      replace(replace(item.definition, 'REFERENCES members(id, team_id)', 'REFERENCES hive_memberships(member_id, team_id)'), 'REFERENCES members(team_id, id)', 'REFERENCES hive_memberships(team_id, member_id)'));
  END LOOP;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'team_domains'::regclass AND conname = 'team_domains_membership_fk') THEN
    ALTER TABLE team_domains ADD CONSTRAINT team_domains_membership_fk FOREIGN KEY (created_by, team_id) REFERENCES hive_memberships(member_id, team_id);
  END IF;
END $$;
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_team_id_fkey;
ALTER TABLE members ADD CONSTRAINT members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE capture_rules DROP CONSTRAINT IF EXISTS capture_rules_team_id_fkey;
ALTER TABLE capture_rules ADD CONSTRAINT capture_rules_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION hive_check_membership_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'admin' AND EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND actor_type = 'agent') THEN
    RAISE EXCEPTION 'Agents cannot administer hives' USING ERRCODE = '23514';
  END IF;
  IF NEW.owner_member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.owner_member_id AND actor_type = 'human') THEN
    RAISE EXCEPTION 'An owner must be human' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_membership_identity BEFORE INSERT OR UPDATE ON hive_memberships FOR EACH ROW EXECUTE FUNCTION hive_check_membership_identity();
CREATE OR REPLACE FUNCTION hive_check_owner_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.owner_member_id AND actor_type = 'human') THEN
    RAISE EXCEPTION 'An owner must be human' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.issuer, NEW.owner_sub, NEW.owner_member_id, NEW.verified_contact_email) IS DISTINCT FROM (OLD.issuer, OLD.owner_sub, OLD.owner_member_id, OLD.verified_contact_email) THEN
    RAISE EXCEPTION 'Owner bindings cannot be reassigned' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_owner_identity BEFORE INSERT OR UPDATE ON agent_owner_bindings FOR EACH ROW EXECUTE FUNCTION hive_check_owner_identity();

CREATE OR REPLACE FUNCTION hive_ensure_personal_hive(owner_id text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE personal_id text; owner_row members;
BEGIN
  SELECT * INTO owner_row FROM members WHERE id = owner_id FOR UPDATE;
  IF owner_row.actor_type IS DISTINCT FROM 'human' THEN RAISE EXCEPTION 'A personal hive needs a human owner'; END IF;
  personal_id := 'team_personal_' || owner_id;
  INSERT INTO teams (id, name, invite_code, invite_expires_at, personal_owner_member_id)
    VALUES (personal_id, owner_row.name, encode(sha256(convert_to('personal:' || owner_id, 'UTF8')), 'hex'), now(), owner_id)
    ON CONFLICT (personal_owner_member_id) WHERE personal_owner_member_id IS NOT NULL DO NOTHING;
  SELECT id INTO personal_id FROM teams WHERE personal_owner_member_id = owner_id;
  INSERT INTO hive_memberships (member_id, team_id, role) VALUES (owner_id, personal_id, 'admin') ON CONFLICT DO NOTHING;
  PERFORM hive_create_default_capture_rules(personal_id, owner_id);
  RETURN personal_id;
END $$;
SELECT hive_ensure_personal_hive(id) FROM members WHERE actor_type = 'human' ORDER BY id;
INSERT INTO hive_memberships (member_id, team_id, role, owner_member_id)
SELECT agent.id, owner_h.team_id, 'member', human.id
FROM auth_accounts a JOIN agent_owner_bindings b ON b.issuer = 'https://auth.agentid.com' AND b.owner_sub = a.owner_sub
JOIN members agent ON agent.id = a.user_id AND agent.actor_type = 'agent' AND agent.disabled_at IS NULL
JOIN members human ON human.id = b.owner_member_id AND human.disabled_at IS NULL
JOIN hive_memberships owner_h ON owner_h.member_id = human.id AND owner_h.removed_at IS NULL
JOIN teams t ON t.id = owner_h.team_id
WHERE a.provider_id = 'agentid' AND a.owner_email_verified
  AND (t.personal_owner_member_id IS NOT NULL OR (human.email_verified AND NOT human.provisional))
ON CONFLICT DO NOTHING;
UPDATE hive_memberships h SET owner_member_id = b.owner_member_id
FROM auth_accounts a JOIN agent_owner_bindings b ON b.issuer = 'https://auth.agentid.com' AND b.owner_sub = a.owner_sub
WHERE a.provider_id = 'agentid' AND a.owner_email_verified AND h.member_id = a.user_id AND h.owner_member_id IS NULL
  AND EXISTS (SELECT 1 FROM hive_memberships owner_h WHERE owner_h.member_id = b.owner_member_id AND owner_h.team_id = h.team_id AND owner_h.removed_at IS NULL);


CREATE OR REPLACE FUNCTION hive_bridge_selected_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.team_id IS NOT NULL THEN
    INSERT INTO hive_memberships (member_id, team_id, role, joined_at, removed_at)
      VALUES (NEW.id, NEW.team_id, NEW.role, NEW.created_at, NEW.removed_at)
      ON CONFLICT (member_id, team_id) DO UPDATE SET role = EXCLUDED.role,
        removed_at = CASE WHEN EXCLUDED.removed_at IS NOT NULL THEN EXCLUDED.removed_at ELSE hive_memberships.removed_at END;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_selected_membership AFTER INSERT OR UPDATE OF team_id, role, removed_at ON members FOR EACH ROW EXECUTE FUNCTION hive_bridge_selected_membership();

ALTER TABLE learnings ADD COLUMN IF NOT EXISTS owner_member_id text REFERENCES members(id);
CREATE OR REPLACE FUNCTION hive_stamp_learning_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_member_id IS NULL THEN
    SELECT coalesce(b.owner_member_id, NEW.member_id) INTO NEW.owner_member_id
    FROM members m LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid'
    LEFT JOIN agent_owner_bindings b ON b.issuer = 'https://auth.agentid.com' AND b.owner_sub = a.owner_sub
    WHERE m.id = NEW.member_id;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_learning_owner BEFORE INSERT ON learnings FOR EACH ROW EXECUTE FUNCTION hive_stamp_learning_owner();
ALTER TABLE learnings DISABLE TRIGGER hive_prepare_learning_version;
ALTER TABLE learnings DISABLE TRIGGER hive_record_learning_version;
UPDATE learnings SET owner_member_id = member_id WHERE owner_member_id IS NULL;
ALTER TABLE learnings ENABLE TRIGGER hive_prepare_learning_version;
ALTER TABLE learnings ENABLE TRIGGER hive_record_learning_version;
ALTER TABLE learnings ALTER COLUMN owner_member_id SET NOT NULL;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['auth_oauth_access_token', 'auth_oauth_refresh_token', 'auth_oauth_consent'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = table_name::regclass AND conname = table_name || '_membership_fk') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id, reference_id) REFERENCES hive_memberships(member_id, team_id) ON DELETE CASCADE', table_name, table_name || '_membership_fk');
    END IF;
  END LOOP;
END $$;
