BEGIN;

ALTER TABLE conversation_work_links
  ADD COLUMN IF NOT EXISTS trigger_message_id uuid NULL;

CREATE INDEX IF NOT EXISTS conversation_work_links_origin_idx
  ON conversation_work_links (tenant_id, conversation_id, trigger_message_id);

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS provider text NULL;

COMMIT;
