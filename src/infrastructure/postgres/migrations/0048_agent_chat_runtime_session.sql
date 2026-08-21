BEGIN;

-- A long-lived Chat brain is not a Product Work execution and therefore does
-- not require a managed Work environment version. The existing FK remains
-- useful for non-null Work runtime snapshots; PostgreSQL permits NULL through
-- that FK once the column is nullable.
ALTER TABLE session_launch_snapshots
  ALTER COLUMN environment_version_id DROP NOT NULL;

-- 0039 already admits scope_kind='agent_chat'. Give that scope the same
-- one-logical-runtime -> one RuntimeSession uniqueness guarantee as the other
-- durable runtime scopes. AgentChatRuntime.id is stored in scope_id.
CREATE UNIQUE INDEX IF NOT EXISTS runtime_sessions_agent_chat_scope_uq
  ON runtime_sessions (scope_id)
  WHERE scope_kind='agent_chat' AND scope_id IS NOT NULL;

COMMIT;
