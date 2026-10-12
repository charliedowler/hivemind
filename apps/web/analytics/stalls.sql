WITH events AS (
  SELECT * FROM analytics_events WHERE occurred_at >= now() - interval '30 days'
    AND (nullif(current_setting('hive.reporting_team', true), '') IS NULL OR team_id = current_setting('hive.reporting_team', true))
), stalled AS (
  SELECT environment, is_test, entrypoint, event_name, reason_code,
    properties->>'purpose' AS purpose, 'observed_failure' AS stall
  FROM events WHERE outcome = 'failed' AND event_name IN ('model.completed','classifier.completed','operation.finished')
  UNION ALL
  SELECT s.environment, s.is_test, s.entrypoint, s.event_name, NULL, coalesce(s.properties->>'purpose',s.properties->>'operation'), 'missing_completion'
  FROM events s WHERE s.event_name IN ('model.started','classifier.started','operation.started') AND s.occurred_at < now() - interval '2 minutes'
    AND NOT EXISTS (SELECT 1 FROM analytics_events f WHERE f.request_id = s.request_id AND f.team_id IS NOT DISTINCT FROM s.team_id
      AND f.event_name = CASE s.event_name WHEN 'model.started' THEN 'model.completed' WHEN 'classifier.started' THEN 'classifier.completed' ELSE 'operation.finished' END
      AND coalesce(f.properties->>'callId',f.properties->>'operationId') = coalesce(s.properties->>'callId',s.properties->>'operationId'))
)
SELECT environment, CASE WHEN is_test THEN 'synthetic' WHEN is_test = false THEN 'real' ELSE 'unclassified' END AS traffic,
  entrypoint, event_name, purpose, stall, reason_code, count(*)::int AS events
FROM stalled GROUP BY 1,2,3,4,5,6,7 ORDER BY 1,2,3,4,5,6,7;
