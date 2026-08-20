BEGIN;

ALTER TABLE runtime_sessions
  DROP CONSTRAINT IF EXISTS runtime_sessions_scope_shape_check,
  DROP CONSTRAINT IF EXISTS runtime_sessions_scope_kind_check,
  ADD CONSTRAINT runtime_sessions_scope_shape_check CHECK (
    (scope_kind = 'product_session' AND product_session_id IS NOT NULL AND task_id IS NULL)
    OR (scope_kind = 'task' AND product_session_id IS NULL AND task_id IS NOT NULL)
    OR (scope_kind = 'team_member' AND product_session_id IS NULL AND task_id IS NOT NULL)
    OR (scope_kind = 'agent_chat' AND product_session_id IS NULL AND task_id IS NULL)
  ),
  ADD CONSTRAINT runtime_sessions_scope_kind_check
    CHECK (scope_kind IN ('product_session','task','team_member','agent_chat'));

CREATE TABLE IF NOT EXISTS chat_dispatches (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_definition_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  through_sequence bigint NOT NULL,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz NULL,
  UNIQUE (dedupe_key)
);
CREATE INDEX IF NOT EXISTS chat_dispatches_pending_idx
  ON chat_dispatches (created_at, id) WHERE published_at IS NULL;

COMMIT;
