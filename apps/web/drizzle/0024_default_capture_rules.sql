SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE FUNCTION hive_create_default_capture_rules(target_team text, creator text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO capture_rules (id, team_id, created_by, name, scope, kind, action, enabled, config, source)
  SELECT 'crule_default_' || category || '_' || target_team, target_team, creator,
    'Exclude ' || label, 'team', 'content_category', 'drop', true,
    jsonb_build_object('name', 'Exclude ' || label, 'scope', 'team', 'kind', 'content_category', 'category', category, 'action', 'drop', 'enabled', true, 'source', 'web'), 'web'
  FROM (VALUES ('credentials', 'credentials'), ('personal_info', 'personal data'), ('customer_data', 'customer data')) AS defaults(category, label)
  ON CONFLICT (id) DO NOTHING;
$$;
SELECT hive_create_default_capture_rules(t.id, owner.id)
FROM teams t
JOIN LATERAL (
  SELECT m.id FROM members m
  WHERE m.team_id = t.id
  ORDER BY (m.role = 'admin' AND m.removed_at IS NULL) DESC, (m.removed_at IS NULL) DESC, m.created_at, m.id LIMIT 1
) owner ON true;
