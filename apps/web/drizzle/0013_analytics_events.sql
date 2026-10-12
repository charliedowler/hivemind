SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS analytics_events (
  event_key text PRIMARY KEY CHECK (event_key ~ '^[0-9a-f]{64}$'),
  event_name text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  team_id text,
  member_id text,
  api_key_id text,
  session_kind text NOT NULL CHECK (session_kind IN ('api_key','web_session','oauth','anonymous','system')),
  request_id text NOT NULL,
  learning_id text,
  entrypoint text NOT NULL CHECK (entrypoint IN ('mcp','web','slack','hook','installer','scheduled','unknown')),
  environment text NOT NULL CHECK (environment IN ('production','preview','development','test','unknown')),
  is_test boolean,
  test_basis text NOT NULL CHECK (test_basis IN ('unit_test','simulation','deployment','unclassified')),
  outcome text NOT NULL,
  reason_code text,
  latency_ms integer CHECK (latency_ms >= 0),
  properties jsonb NOT NULL CHECK (jsonb_typeof(properties) = 'object')
);
CREATE INDEX IF NOT EXISTS analytics_events_team_time_idx ON analytics_events (team_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx ON analytics_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_request_idx ON analytics_events (request_id, event_name);
CREATE INDEX IF NOT EXISTS analytics_events_member_idx ON analytics_events (team_id, member_id, occurred_at);
CREATE OR REPLACE FUNCTION hive_analytics_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'analytics_events is append-only' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS hive_analytics_immutable ON analytics_events;
CREATE TRIGGER hive_analytics_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON analytics_events FOR EACH STATEMENT EXECUTE FUNCTION hive_analytics_immutable();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hive_reporting') THEN
    CREATE ROLE hive_reporting NOLOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA public TO hive_reporting;
GRANT SELECT ON analytics_events TO hive_reporting;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON analytics_events FROM hive_reporting;
