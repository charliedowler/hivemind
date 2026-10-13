DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM agent_credentials) OR EXISTS (SELECT 1 FROM agent_connection_requests) OR EXISTS (SELECT 1 FROM join_share_offers) OR EXISTS (SELECT 1 FROM project_sharing_grants WHERE human_instruction IS NOT NULL) THEN
    RAISE EXCEPTION 'Bootstrap history exists; rollback would discard ownership or consent';
  END IF;
END $$;
DROP TABLE join_share_offers;
DROP TABLE agent_connection_requests;
ALTER TABLE project_sharing_grants DROP COLUMN human_instruction, DROP COLUMN instructed_by;
CREATE OR REPLACE FUNCTION hive_stamp_learning_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_member_id IS NULL THEN
    SELECT coalesce(b.owner_member_id, NEW.member_id) INTO NEW.owner_member_id
    FROM members m LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid'
    LEFT JOIN agent_owner_bindings b ON b.issuer = 'https://auth.agentid.com' AND b.owner_sub = a.owner_sub WHERE m.id = NEW.member_id;
  END IF;
  RETURN NEW;
END $$;
DROP VIEW hive_agent_owners;
DROP TABLE agent_credentials;
DROP FUNCTION hive_guard_agent_credential();
ALTER TABLE members DROP COLUMN provisional_expires_at;
DELETE FROM _migrations WHERE name = '0030_agent_bootstrap.sql';
