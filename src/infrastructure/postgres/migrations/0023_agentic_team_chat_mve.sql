BEGIN;

ALTER TABLE team_versions DROP CONSTRAINT IF EXISTS team_versions_execution_mode_check;
ALTER TABLE team_versions ADD CONSTRAINT team_versions_execution_mode_check
  CHECK (execution_mode IN ('legacy_graph','collaborative_mve','agentic_mve'));
ALTER TABLE team_versions DROP CONSTRAINT IF EXISTS team_versions_execution_shape_check;
ALTER TABLE team_versions ADD CONSTRAINT team_versions_execution_shape_check CHECK (
  (execution_mode = 'legacy_graph' AND graph IS NOT NULL AND collaboration_spec IS NULL)
  OR (execution_mode IN ('collaborative_mve','agentic_mve') AND graph IS NULL AND collaboration_spec IS NOT NULL)
);

ALTER TABLE team_runs
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'collaborative_mve',
  ADD COLUMN IF NOT EXISTS control_state text NULL,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_turn_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stop_reason text NULL,
  ADD COLUMN IF NOT EXISTS completion_requested_by_run_id uuid NULL;
ALTER TABLE team_runs DROP CONSTRAINT IF EXISTS team_runs_control_state_check;
ALTER TABLE team_runs ADD CONSTRAINT team_runs_control_state_check CHECK
  (control_state IS NULL OR control_state IN ('lead_ready','lead_running','member_work_running','terminal'));

ALTER TABLE team_work_items DROP CONSTRAINT IF EXISTS team_work_items_status_check;
ALTER TABLE team_work_items ADD CONSTRAINT team_work_items_status_check CHECK
  (status IN ('pending','in_progress','completed','blocked','cancelled','open','accepted'));

CREATE TABLE IF NOT EXISTS team_work_item_attempts (
  id uuid PRIMARY KEY, work_item_id uuid NOT NULL REFERENCES team_work_items(id),
  team_run_id uuid NOT NULL REFERENCES team_runs(id), attempt_no integer NOT NULL CHECK (attempt_no > 0),
  assignee_member_id uuid NOT NULL REFERENCES team_member_runs(id),
  requested_by_lead_task_id uuid NOT NULL REFERENCES tasks(id), feedback text NULL,
  execution_task_id uuid NULL REFERENCES tasks(id), status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  result_summary text NULL, tenant_id text NOT NULL, workspace_id text NOT NULL,
  principal_type text NOT NULL, principal_id text NOT NULL, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, completed_at timestamptz NULL,
  UNIQUE (work_item_id, attempt_no), UNIQUE (execution_task_id)
);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS team_member_run_id uuid NULL REFERENCES team_member_runs(id),
  ADD COLUMN IF NOT EXISTS team_sequence integer NULL,
  ADD COLUMN IF NOT EXISTS team_task_kind text NULL;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_team_task_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_team_task_kind_check CHECK
  (team_task_kind IS NULL OR team_task_kind IN ('lead_turn','work_attempt'));

CREATE TABLE IF NOT EXISTS team_command_receipts (
  source_run_id uuid NOT NULL REFERENCES runs(id), command_hash text NOT NULL,
  command_name text NOT NULL, result_json jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (source_run_id, command_hash)
);

COMMIT;
