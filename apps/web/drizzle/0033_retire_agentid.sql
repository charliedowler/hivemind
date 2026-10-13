SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

UPDATE members m
SET disabled_at = coalesce(m.disabled_at, now()), updated_at = now()
WHERE m.actor_type = 'agent'
  AND EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = m.id AND a.provider_id = 'agentid');

DELETE FROM web_sessions s
USING members m
WHERE s.member_id = m.id AND m.actor_type = 'agent'
  AND EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = m.id AND a.provider_id = 'agentid');

UPDATE hive_join_capabilities c
SET revoked_at = coalesce(c.revoked_at, now())
WHERE EXISTS (SELECT 1 FROM auth_accounts a JOIN members m ON m.id = a.user_id WHERE m.id = c.agent_member_id AND m.actor_type = 'agent' AND a.provider_id = 'agentid');
