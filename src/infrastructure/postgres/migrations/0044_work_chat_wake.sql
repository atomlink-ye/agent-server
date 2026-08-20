BEGIN;

CREATE TABLE IF NOT EXISTS work_chat_wake_states (
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_id uuid NOT NULL,
  last_observed_state text NOT NULL CHECK (
    last_observed_state IN ('running', 'needs_you', 'complete', 'problem', 'not_captured')
  ),
  transition_no bigint NOT NULL CHECK (transition_no > 0),
  last_observed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, work_id)
);

CREATE TABLE IF NOT EXISTS work_chat_wake_outbox (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_id uuid NOT NULL,
  transition_no bigint NOT NULL CHECK (transition_no > 0),
  conversation_id uuid NOT NULL,
  work_ref text NOT NULL,
  title text NOT NULL,
  product_state text NOT NULL CHECK (
    product_state IN ('complete', 'needs_you', 'problem')
  ),
  problem_kind text NULL CHECK (
    problem_kind IN ('failed', 'cancelled', 'not_captured')
  ),
  attention_reason text NULL CHECK (
    attention_reason IN ('completion_approval_pending', 'not_captured')
  ),
  result_summary text NULL,
  result_capture_status text NOT NULL CHECK (
    result_capture_status IN ('present', 'not_present', 'redacted', 'not_captured')
  ),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_by text NULL,
  lease_expires_at timestamptz NULL,
  delivered_at timestamptz NULL,
  UNIQUE (tenant_id, workspace_id, work_id, transition_no)
);
CREATE INDEX IF NOT EXISTS work_chat_wake_outbox_pending_idx
  ON work_chat_wake_outbox (created_at, id)
  WHERE delivered_at IS NULL;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS delivery_id text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_delivery_id_uq
  ON chat_messages (tenant_id, conversation_id, delivery_id)
  WHERE delivery_id IS NOT NULL;

COMMIT;
