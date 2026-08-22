BEGIN;

-- N2: one unclaimed activation per Agent/Conversation burst. A claimed row is
-- already a frozen activation snapshot, so later causes create the next row.
ALTER TABLE chat_dispatches
  ADD COLUMN IF NOT EXISTS activation_key text,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS available_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE chat_dispatches
SET activation_key = COALESCE(activation_key, 'legacy:' || id::text),
    priority = COALESCE(priority, 'normal'),
    available_at = COALESCE(available_at, created_at),
    updated_at = COALESCE(updated_at, created_at);

ALTER TABLE chat_dispatches
  ALTER COLUMN activation_key SET NOT NULL,
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN priority SET DEFAULT 'normal',
  ALTER COLUMN available_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='chat_dispatches'::regclass
      AND conname='chat_dispatches_priority_check'
  ) THEN
    ALTER TABLE chat_dispatches
      ADD CONSTRAINT chat_dispatches_priority_check
      CHECK (priority IN ('normal','urgent'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS chat_dispatches_open_activation_uq
  ON chat_dispatches (activation_key)
  WHERE published_at IS NULL AND claimed_by IS NULL;

CREATE INDEX IF NOT EXISTS chat_dispatches_activation_ready_idx
  ON chat_dispatches (priority, available_at, created_at, id)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_activation_causes (
  id bigserial PRIMARY KEY,
  cause_key text NOT NULL UNIQUE,
  dispatch_id bigint NOT NULL REFERENCES chat_dispatches(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  agent_definition_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  cause_kind text NOT NULL CHECK (cause_kind IN ('conversation_message','work_wake')),
  through_sequence bigint NOT NULL CHECK (through_sequence > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_activation_causes_dispatch_idx
  ON chat_activation_causes (dispatch_id, id);

-- Old dispatch rows predate explicit causes. Backfill a synthetic cause so the
-- projection stays total while retaining the original durable dedupe identity.
INSERT INTO chat_activation_causes
  (cause_key, dispatch_id, tenant_id, agent_definition_id, conversation_id,
   cause_kind, through_sequence, payload, created_at)
SELECT 'legacy:' || d.id::text,
       d.id,
       d.tenant_id,
       d.agent_definition_id,
       d.conversation_id,
       'conversation_message',
       d.through_sequence,
       '{}'::jsonb,
       d.created_at
FROM chat_dispatches d
ON CONFLICT (cause_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_chat_runtime_watermarks (
  agent_chat_runtime_id uuid NOT NULL REFERENCES agent_chat_runtimes(id) ON DELETE CASCADE,
  runtime_epoch integer NOT NULL CHECK (runtime_epoch > 0),
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  last_admitted_sequence bigint NOT NULL DEFAULT 0 CHECK (last_admitted_sequence >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (agent_chat_runtime_id, runtime_epoch, conversation_id)
);
CREATE INDEX IF NOT EXISTS agent_chat_runtime_watermarks_lookup_idx
  ON agent_chat_runtime_watermarks (tenant_id, conversation_id, agent_chat_runtime_id, runtime_epoch);

COMMIT;
