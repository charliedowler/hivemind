SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, environment,
  CASE WHEN is_test THEN 'synthetic' WHEN is_test = false THEN 'real' ELSE 'unclassified' END AS traffic,
  entrypoint, event_name,
  count(*)::int AS events,
  round(100.0 * count(*) FILTER (WHERE event_name = 'ask.performed' AND (properties->>'gapReported')::boolean) / nullif(count(*) FILTER (WHERE event_name = 'ask.performed'),0),1) AS ask_gap_percent,
  count(*) FILTER (WHERE reason_code = 'sensitive_refused')::int AS sensitive_refusals,
  count(*) FILTER (WHERE outcome IN ('failed','refused','fallback'))::int AS failures_or_fallbacks,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric)::int AS p50_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric)::int AS p95_ms
FROM analytics_events
WHERE occurred_at >= now() - interval '30 days' AND event_name IN ('ask.performed','search.performed','classifier.completed','model.completed','learning.pushed')
  AND (nullif(current_setting('hive.reporting_team', true), '') IS NULL OR team_id = current_setting('hive.reporting_team', true))
GROUP BY 1,2,3,4,5 ORDER BY 1 DESC,2,3,4,5;
