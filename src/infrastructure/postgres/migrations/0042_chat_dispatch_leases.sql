BEGIN;

ALTER TABLE agent_chat_runtimes
  ADD COLUMN IF NOT EXISTS id uuid;

ALTER TABLE agent_chat_runtimes
  ALTER COLUMN id SET DEFAULT md5(random()::text || clock_timestamp()::text)::uuid;

UPDATE agent_chat_runtimes
SET id = md5(tenant_id || ':' || agent_definition_id)::uuid
WHERE id IS NULL;

ALTER TABLE agent_chat_runtimes
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE agent_chat_runtimes
  DROP CONSTRAINT IF EXISTS agent_chat_runtimes_pkey;

ALTER TABLE agent_chat_runtimes
  ADD CONSTRAINT agent_chat_runtimes_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS agent_chat_runtimes_tenant_agent_uq
  ON agent_chat_runtimes (tenant_id, agent_definition_id);

ALTER TABLE chat_dispatches
  ADD COLUMN IF NOT EXISTS claimed_by text NULL,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'chat_dispatches'::regclass
      AND conname = 'chat_dispatches_attempt_count_check'
  ) THEN
    ALTER TABLE chat_dispatches
      ADD CONSTRAINT chat_dispatches_attempt_count_check
      CHECK (attempt_count >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS chat_dispatches_claim_idx
  ON chat_dispatches (published_at, claim_expires_at, created_at, id);

COMMIT;
