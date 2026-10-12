WITH events AS (
  SELECT * FROM analytics_events
  WHERE occurred_at >= now() - interval '30 days'
    AND (nullif(current_setting('hive.reporting_team', true), '') IS NULL OR team_id = current_setting('hive.reporting_team', true))
)
SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, environment,
  CASE WHEN is_test THEN 'synthetic' WHEN is_test = false THEN 'real' ELSE 'unclassified' END AS traffic,
  entrypoint, count(*)::int AS interactions,
  count(DISTINCT (team_id, member_id)) FILTER (WHERE member_id IS NOT NULL)::int AS active_members,
  count(DISTINCT team_id)::int AS active_teams
FROM events
WHERE event_name IN ('learning.pushed','search.performed','ask.performed','recent.performed','learning.viewed','learning.feedback','tree.read','snapshot.exported')
  AND outcome NOT IN ('failed','refused')
  AND (event_name <> 'search.performed' OR NOT EXISTS (
    SELECT 1 FROM events sibling WHERE sibling.request_id = events.request_id AND sibling.event_name = 'ask.performed'
  ))
GROUP BY 1,2,3,4 ORDER BY 1 DESC,2,3,4;
