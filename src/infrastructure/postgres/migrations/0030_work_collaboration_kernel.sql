BEGIN;

ALTER TABLE team_messages
  ADD COLUMN IF NOT EXISTS about_work_item_id uuid NULL REFERENCES team_work_items(id),
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid NULL REFERENCES team_messages(id),
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS requires_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS source_task_id uuid NULL REFERENCES tasks(id),
  ADD COLUMN IF NOT EXISTS source_run_id uuid NULL REFERENCES runs(id);

ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_priority_check;
ALTER TABLE team_messages ADD CONSTRAINT team_messages_priority_check
  CHECK (priority IN ('normal','urgent'));

ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_status_check;
ALTER TABLE team_messages ADD CONSTRAINT team_messages_status_check
  CHECK (status IN ('queued','consumed','delivered','read','acknowledged','cancelled'));

ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_kind_status_check;
ALTER TABLE team_messages ADD CONSTRAINT team_messages_kind_status_check CHECK (
  (
    kind IN ('wake','work_update')
    AND (
      (status='queued' AND consumed_by_task_id IS NULL AND consumed_at IS NULL)
      OR
      (status='consumed' AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL)
    )
  )
  OR
  (
    kind='direct'
    AND (
      (status='queued' AND consumed_by_task_id IS NULL AND consumed_at IS NULL AND acknowledged_at IS NULL AND cancelled_at IS NULL)
      OR
      (status IN ('consumed','delivered','read') AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
      OR
      (status='acknowledged' AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL AND acknowledged_at IS NOT NULL AND cancelled_at IS NULL)
      OR
      (status='cancelled' AND cancelled_at IS NOT NULL)
    )
  )
);

CREATE TABLE IF NOT EXISTS collaboration_checkpoints (
  id uuid PRIMARY KEY,
  team_run_id uuid NOT NULL REFERENCES team_runs(id),
  work_item_id uuid NOT NULL REFERENCES team_work_items(id),
  attempt_id uuid NULL REFERENCES team_work_item_attempts(id),
  participant_member_run_id uuid NOT NULL REFERENCES team_member_runs(id),
  source_task_id uuid NOT NULL REFERENCES tasks(id),
  source_run_id uuid NOT NULL REFERENCES runs(id),
  summary text NOT NULL,
  next_step text NULL,
  blocker text NULL,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT collaboration_checkpoints_summary_check CHECK (length(summary) BETWEEN 1 AND 4096)
);

CREATE INDEX IF NOT EXISTS collaboration_checkpoints_work_idx
  ON collaboration_checkpoints (team_run_id, work_item_id, created_at, id);

CREATE TABLE IF NOT EXISTS collaboration_submissions (
  id uuid PRIMARY KEY,
  team_run_id uuid NOT NULL REFERENCES team_runs(id),
  work_item_id uuid NOT NULL REFERENCES team_work_items(id),
  attempt_id uuid NOT NULL REFERENCES team_work_item_attempts(id),
  submitted_by_member_run_id uuid NOT NULL REFERENCES team_member_runs(id),
  source_task_id uuid NOT NULL REFERENCES tasks(id),
  source_run_id uuid NOT NULL REFERENCES runs(id),
  summary text NOT NULL,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  artifact_refs text[] NOT NULL DEFAULT '{}',
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT collaboration_submissions_summary_check CHECK (length(summary) BETWEEN 1 AND 4096),
  CONSTRAINT collaboration_submissions_attempt_unique UNIQUE (attempt_id)
);

CREATE INDEX IF NOT EXISTS collaboration_submissions_work_idx
  ON collaboration_submissions (team_run_id, work_item_id, created_at, id);

COMMIT;
