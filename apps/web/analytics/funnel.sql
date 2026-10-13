WITH events AS (
  SELECT * FROM analytics_events WHERE occurred_at >= now() - interval '30 days'
    AND (nullif(current_setting('hive.reporting_team', true), '') IS NULL OR team_id = current_setting('hive.reporting_team', true))
), signups AS (
  SELECT team_id, member_id, environment, is_test, min(occurred_at) AS signup_at, bool_or(properties->>'earlyAccessId' IS NOT NULL) AS from_waitlist
  FROM events WHERE event_name = 'access.changed' AND outcome = 'signup' AND member_id IS NOT NULL
  GROUP BY 1,2,3,4
), access AS (
  SELECT s.*, a.access_at FROM signups s LEFT JOIN LATERAL (
    SELECT min(e.occurred_at) AS access_at FROM events e WHERE e.team_id = s.team_id AND e.member_id = s.member_id
      AND e.environment = s.environment AND e.is_test IS NOT DISTINCT FROM s.is_test
      AND e.event_name = 'access.changed' AND e.outcome IN ('key_created','mcp_oauth_authorized') AND e.occurred_at >= s.signup_at
  ) a ON true
), pushes AS (
  SELECT a.*, p.push_at FROM access a LEFT JOIN LATERAL (
    SELECT min(e.occurred_at) AS push_at FROM events e WHERE e.team_id = a.team_id AND e.member_id = a.member_id
      AND e.environment = a.environment AND e.is_test IS NOT DISTINCT FROM a.is_test
      AND e.event_name = 'learning.pushed' AND e.outcome = 'completed' AND e.occurred_at >= a.access_at
  ) p ON true
), asks AS (
  SELECT p.*, a.ask_at FROM pushes p LEFT JOIN LATERAL (
    SELECT min(e.occurred_at) AS ask_at FROM events e WHERE e.team_id = p.team_id AND e.member_id = p.member_id
      AND e.environment = p.environment AND e.is_test IS NOT DISTINCT FROM p.is_test
      AND e.event_name = 'ask.performed' AND e.occurred_at >= p.push_at
  ) a ON true
)
SELECT environment, CASE WHEN is_test THEN 'synthetic' WHEN is_test = false THEN 'real' ELSE 'unclassified' END AS traffic,
  count(*) FILTER (WHERE from_waitlist)::int AS waitlisted_signups, count(*)::int AS signups, count(access_at)::int AS key_or_oauth, count(push_at)::int AS first_push, count(ask_at)::int AS first_ask
FROM asks GROUP BY 1,2 ORDER BY 1,2;
