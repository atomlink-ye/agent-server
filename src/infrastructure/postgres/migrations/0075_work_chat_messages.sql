BEGIN;

-- Work Chat is a Work-scoped shared channel. It deliberately has no author or
-- conversation identity; all human messages are rendered as User.
CREATE TABLE work_chat_messages (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN ('user','lead','system')),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 16384),
  status text NOT NULL CHECK (status IN ('queued','processing','replied','failed')),
  reply_to_message_id uuid NULL REFERENCES work_chat_messages(id),
  client_request_id text NULL,
  lease_owner text NULL,
  lease_fence bigint NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  lease_expires_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  source_runtime_turn_id uuid NULL,
  failure_code text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, workspace_id, work_id, sequence),
  UNIQUE (tenant_id, workspace_id, work_id, client_request_id),
  FOREIGN KEY (work_id, tenant_id, workspace_id)
    REFERENCES works (id, tenant_id, workspace_id),
  CHECK ((kind = 'user' AND reply_to_message_id IS NULL)
      OR (kind = 'lead' AND reply_to_message_id IS NOT NULL)
      OR kind = 'system')
);

CREATE INDEX work_chat_messages_order_idx
  ON work_chat_messages (tenant_id, workspace_id, work_id, sequence);
CREATE INDEX work_chat_messages_queue_idx
  ON work_chat_messages (tenant_id, workspace_id, work_id, sequence)
  WHERE kind = 'user' AND status IN ('queued','processing');
CREATE INDEX work_chat_messages_lease_idx
  ON work_chat_messages (lease_expires_at)
  WHERE kind = 'user' AND status = 'processing';

-- Runtime scope/source are intentionally widened here, after the replacement
-- runtime schema owns these tables. Formal team_member/run scopes remain
-- unchanged; Work Chat is a separate temporary reply scope.
ALTER TABLE runtime_sessions
  ADD CONSTRAINT runtime_sessions_work_chat_scope_check CHECK (
    scope_kind <> 'work_chat' OR scope_id IS NOT NULL
);

ALTER TABLE runtime_turns ADD COLUMN IF NOT EXISTS output_text text NULL;

CREATE UNIQUE INDEX work_chat_one_lead_reply_per_user_idx
  ON work_chat_messages (reply_to_message_id)
  WHERE kind = 'lead' AND reply_to_message_id IS NOT NULL;
CREATE UNIQUE INDEX work_chat_one_runtime_turn_reply_idx
  ON work_chat_messages (source_runtime_turn_id)
  WHERE kind = 'lead' AND source_runtime_turn_id IS NOT NULL;

COMMIT;
