BEGIN;

ALTER TABLE team_versions ADD COLUMN IF NOT EXISTS execution_mode text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='team_versions_execution_mode_not_null') THEN
    UPDATE team_versions SET execution_mode = 'legacy_graph' WHERE execution_mode IS NULL;
    ALTER TABLE team_versions ALTER COLUMN execution_mode SET NOT NULL;
    ALTER TABLE team_versions ALTER COLUMN execution_mode SET DEFAULT 'legacy_graph';
    ALTER TABLE team_versions ADD CONSTRAINT team_versions_execution_mode_check CHECK (execution_mode IN ('legacy_graph','collaborative_mve'));
  END IF;
END $$;

ALTER TABLE team_versions ADD COLUMN IF NOT EXISTS collaboration_spec jsonb NULL;

ALTER TABLE team_versions ALTER COLUMN graph DROP NOT NULL;

ALTER TABLE team_versions
  DROP CONSTRAINT IF EXISTS team_versions_collaboration_spec_check,
  DROP CONSTRAINT IF EXISTS team_versions_execution_shape_check;
ALTER TABLE team_versions ADD CONSTRAINT team_versions_execution_shape_check CHECK (
  (execution_mode = 'legacy_graph' AND graph IS NOT NULL AND collaboration_spec IS NULL) OR
  (execution_mode = 'collaborative_mve' AND graph IS NULL AND collaboration_spec IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS team_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  root_task_id uuid NOT NULL UNIQUE,
  root_run_id uuid NOT NULL UNIQUE,
  team_version_id uuid NOT NULL,
  environment_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','waiting','succeeded','failed')),
  phase text NOT NULL DEFAULT 'lead_kickoff' CHECK (phase IN ('lead_kickoff','member_work','lead_finalize','done')),
  final_text text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(id, tenant_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS team_member_runs (
  id uuid PRIMARY KEY,
  team_run_id uuid NOT NULL REFERENCES team_runs(id),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('lead','member')),
  agent_version_id uuid NOT NULL,
  runtime_session_id uuid NULL,
  status text NOT NULL DEFAULT 'starting' CHECK (status IN ('starting','active','idle','stopped','failed')),
  current_work_item_id uuid NULL,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(team_run_id, name),
  UNIQUE(id, team_run_id)
);

CREATE TABLE IF NOT EXISTS team_work_items (
  id uuid PRIMARY KEY,
  team_run_id uuid NOT NULL REFERENCES team_runs(id),
  subject text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked','cancelled')),
  owner_member_id uuid NULL REFERENCES team_member_runs(id),
  created_by_member_id uuid NOT NULL REFERENCES team_member_runs(id),
  completion_summary text NULL,
  execution_task_id uuid NULL,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz NULL
);

ALTER TABLE runtime_sessions
  DROP CONSTRAINT IF EXISTS runtime_sessions_scope_shape_check,
  DROP CONSTRAINT IF EXISTS runtime_sessions_scope_kind_check,
  ADD CONSTRAINT runtime_sessions_scope_shape_check CHECK (
    (scope_kind = 'product_session' AND product_session_id IS NOT NULL AND task_id IS NULL)
    OR (scope_kind = 'task' AND product_session_id IS NULL AND task_id IS NOT NULL)
    OR (scope_kind = 'team_member' AND product_session_id IS NULL AND task_id IS NOT NULL)
  ),
  ADD CONSTRAINT runtime_sessions_scope_kind_check
    CHECK (scope_kind IN ('product_session','task','team_member'));

CREATE UNIQUE INDEX IF NOT EXISTS tasks_root_logical_step_key_unique
  ON tasks (root_task_id, logical_step_key)
  WHERE logical_step_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS team_work_items_one_in_progress_per_member
  ON team_work_items (team_run_id, owner_member_id)
  WHERE status = 'in_progress' AND owner_member_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_registry_idempotency (
  operation text NOT NULL CHECK (operation IN ('import','publish')),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  definition_id uuid NULL,
  version_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (operation, tenant_id, workspace_id, principal_type, principal_id, idempotency_key)
);

COMMIT;
