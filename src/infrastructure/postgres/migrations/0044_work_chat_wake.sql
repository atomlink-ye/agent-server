BEGIN;

CREATE TABLE IF NOT EXISTS work_chat_wake_states (
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_id uuid NOT NULL,
  last_observed_state text NOT NULL CHECK (
    last_observed_state IN ('running', 'needs_you', 'complete', 'problem', 'not_captured')
  ),
  last_observed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, work_id)
);

COMMIT;
