SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
  CASE WHEN source IN ('landing','waitlist') THEN source ELSE 'other' END AS source,
  count(DISTINCT lower(trim(email)))::int AS signups
FROM early_access WHERE created_at >= now() - interval '30 days'
GROUP BY 1,2 ORDER BY 1 DESC,2;
