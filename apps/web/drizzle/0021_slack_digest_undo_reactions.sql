SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE slack_digest_instructions DROP CONSTRAINT IF EXISTS slack_digest_instructions_reaction_check;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='slack_digest_instructions'::regclass AND conname='slack_digest_instructions_reaction_check') THEN
  ALTER TABLE slack_digest_instructions ADD CONSTRAINT slack_digest_instructions_reaction_check CHECK (reaction IS NULL OR reaction IN ('+1','white_check_mark'));
 END IF;
END $$;
INSERT INTO slack_tool_actions(id,team_id,member_id,channel_id,thread_ts,message_ts,tool_name,inverse,reply,created_at,expires_at,undone_at)
SELECT 'sact_'||split_part(i.id,'_',2),i.team_id,i.member_id,i.channel_id,i.thread_ts,i.message_ts,
 CASE WHEN i.action='set' THEN 'hive_schedule_digest' ELSE 'hive_list_digest_schedules' END,
 jsonb_build_object('kind','digest_instruction','reversible',true,'payload',jsonb_build_object('instructionId',i.id)),i.reply,i.created_at,i.created_at+interval '1 hour',i.reversed_at
FROM slack_digest_instructions i WHERE i.action IN ('set','disable')
ON CONFLICT DO NOTHING;
