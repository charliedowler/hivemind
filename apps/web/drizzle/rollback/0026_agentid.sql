SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM members WHERE actor_type = 'agent') OR EXISTS (SELECT 1 FROM agent_owner_invites) THEN
    RAISE EXCEPTION 'Rollback refuses stored agent identities or owner invitations';
  END IF;
END $$;
DROP TABLE agent_owner_invites;
ALTER TABLE auth_accounts DROP COLUMN owner_sub, DROP COLUMN owner_name, DROP COLUMN owner_email, DROP COLUMN owner_email_verified;
ALTER TABLE members DROP CONSTRAINT members_agent_role_check, DROP CONSTRAINT members_actor_type_check;
ALTER TABLE members DROP COLUMN actor_type;
