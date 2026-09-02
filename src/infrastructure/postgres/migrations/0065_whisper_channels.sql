BEGIN;

-- Whispers reuse the conversation plane: a whisper channel is a
-- `conversations` row (kind='whisper') whose only members are two or more
-- `agent_definition` rows. Humans are never members -- they read whisper
-- channels through a separate peek surface, never through membership.
DO $$
DECLARE
  kind_check_name text;
BEGIN
  SELECT con.conname INTO kind_check_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'conversations'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%kind%';
  IF kind_check_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', kind_check_name);
  END IF;
END $$;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('direct', 'group', 'whisper'));

-- Which public conversation/message (if any) an agent was replying to when
-- it decided to whisper. Nullable: a whisper can also originate from a Team
-- Run/Workboard context, captured only as a free-form work_ref in that case.
CREATE TABLE IF NOT EXISTS whisper_channel_origins (
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL,
  origin_conversation_id uuid NULL,
  origin_message_id uuid NULL,
  work_ref text NULL,
  initiated_by_agent_definition_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id),
  FOREIGN KEY (conversation_id, tenant_id) REFERENCES conversations (id, tenant_id),
  FOREIGN KEY (origin_conversation_id, tenant_id) REFERENCES conversations (id, tenant_id),
  FOREIGN KEY (origin_message_id) REFERENCES chat_messages (id)
);

COMMIT;
