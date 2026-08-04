BEGIN;

CREATE TABLE IF NOT EXISTS team_messages (
  id uuid PRIMARY KEY,
  team_run_id uuid NOT NULL REFERENCES team_runs(id),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  sender_member_run_id uuid NULL REFERENCES team_member_runs(id),
  recipient_member_run_id uuid NOT NULL REFERENCES team_member_runs(id),
  work_item_id uuid NULL REFERENCES team_work_items(id),
  attempt_id uuid NULL REFERENCES team_work_item_attempts(id),
  kind text NOT NULL CHECK (kind IN ('wake','work_update')),
  dedup_key text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','consumed')),
  consumed_by_task_id uuid NULL REFERENCES tasks(id),
  created_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  UNIQUE (team_run_id, dedup_key),
  UNIQUE (team_run_id, sequence)
);

CREATE INDEX IF NOT EXISTS team_messages_queued_recipient_idx
  ON team_messages (team_run_id, recipient_member_run_id, sequence)
  WHERE status = 'queued';

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_team_message_id uuid NULL REFERENCES team_messages(id),
  ADD COLUMN IF NOT EXISTS input_team_message_ids uuid[] NULL;

COMMIT;
