BEGIN;

ALTER TABLE runtime_sessions
  ADD COLUMN IF NOT EXISTS agent_chat_runtime_id uuid NULL,
  ADD COLUMN IF NOT EXISTS runtime_epoch integer NULL;

-- 0048 stored the long-lived AgentChatRuntime UUID in scope_id before the
-- runtime session had an explicit epoch dimension. Preserve those legacy rows
-- as epoch 1; all new agent_chat rows use the dedicated typed columns.
UPDATE runtime_sessions
SET agent_chat_runtime_id = scope_id,
    runtime_epoch = 1
WHERE scope_kind = 'agent_chat'
  AND scope_id IS NOT NULL
  AND agent_chat_runtime_id IS NULL
  AND runtime_epoch IS NULL;

DROP INDEX IF EXISTS runtime_sessions_agent_chat_scope_uq;

CREATE UNIQUE INDEX IF NOT EXISTS runtime_sessions_agent_chat_epoch_uq
  ON runtime_sessions (agent_chat_runtime_id, runtime_epoch)
  WHERE scope_kind = 'agent_chat';

ALTER TABLE runtime_sessions
  DROP CONSTRAINT IF EXISTS runtime_sessions_agent_chat_epoch_check,
  ADD CONSTRAINT runtime_sessions_agent_chat_epoch_check CHECK (
    scope_kind <> 'agent_chat'
    OR (
      agent_chat_runtime_id IS NOT NULL
      AND runtime_epoch IS NOT NULL
      AND runtime_epoch > 0
    )
  );

COMMIT;
