BEGIN;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS work_item_dispatch jsonb NULL;

COMMIT;
