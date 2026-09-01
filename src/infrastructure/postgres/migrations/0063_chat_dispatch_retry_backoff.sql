BEGIN;

-- Bounded Chat delivery retry. A failed activation must become claimable again
-- only after a backoff, and a permanently undeliverable one must park in a
-- terminal inspectable state instead of being retried forever.
ALTER TABLE chat_dispatches
  ADD COLUMN IF NOT EXISTS last_error_name text NULL,
  ADD COLUMN IF NOT EXISTS last_failed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS dead_letter_reason text NULL;

-- A parked activation stays unpublished so it remains inspectable, so it must
-- stop occupying the single open-activation slot for its Agent/Conversation.
-- Otherwise one undeliverable activation would absorb every later cause.
DROP INDEX IF EXISTS chat_dispatches_open_activation_uq;
CREATE UNIQUE INDEX chat_dispatches_open_activation_uq
  ON chat_dispatches (activation_key)
  WHERE published_at IS NULL AND claimed_by IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_dispatches_dead_letter_idx
  ON chat_dispatches (dead_lettered_at, tenant_id, conversation_id)
  WHERE dead_lettered_at IS NOT NULL;

COMMIT;
