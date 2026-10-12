SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, environment,
  CASE WHEN is_test THEN 'synthetic' WHEN is_test = false THEN 'real' ELSE 'unclassified' END AS traffic,
  properties->>'kind' AS kind, properties->>'source' AS source,
  count(*) FILTER (WHERE event_name = 'learning.pushed' AND outcome = 'completed')::int AS pushes,
  count(*) FILTER (WHERE event_name = 'learning.pushed' AND (properties->>'merged')::boolean)::int AS merges,
  count(*) FILTER (WHERE event_name = 'learning.superseded')::int AS supersessions,
  sum((properties->>'frictionMinutes')::int) AS friction_minutes,
  count(*) FILTER (WHERE properties->>'kind' = 'friction' AND properties->>'frictionMinutes' IS NULL)::int AS unmeasured_friction
FROM analytics_events
WHERE occurred_at >= now() - interval '30 days' AND event_name IN ('learning.pushed','learning.superseded') AND outcome = 'completed'
  AND (nullif(current_setting('hive.reporting_team', true), '') IS NULL OR team_id = current_setting('hive.reporting_team', true))
GROUP BY 1,2,3,4,5 ORDER BY 1 DESC,2,3,4,5;
