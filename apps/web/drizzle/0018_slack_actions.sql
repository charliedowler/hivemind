SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE slack_tool_actions (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id),
 member_id text NOT NULL,
 channel_id text NOT NULL,
 thread_ts text NOT NULL,
 message_ts text NOT NULL,
 tool_name text NOT NULL,
 inverse jsonb NOT NULL,
 reply text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
 undone_at timestamptz,
 FOREIGN KEY(member_id,team_id) REFERENCES members(id,team_id),
 UNIQUE(team_id,channel_id,message_ts)
);
CREATE INDEX slack_tool_actions_thread_idx ON slack_tool_actions(team_id,channel_id,thread_ts,created_at DESC,id DESC);
