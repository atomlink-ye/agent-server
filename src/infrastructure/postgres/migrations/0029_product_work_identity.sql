BEGIN;

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE works (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  current_definition_version_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  origin text NOT NULL DEFAULT 'created' CHECK (origin IN ('created','backfilled')),
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id, workspace_id),
  FOREIGN KEY (workspace_id, tenant_id)
    REFERENCES workspaces (id, tenant_id),
  FOREIGN KEY (definition_id) REFERENCES team_definitions (id),
  FOREIGN KEY (current_definition_version_id) REFERENCES team_versions (id)
);

CREATE TABLE work_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_id uuid NOT NULL,
  definition_version_id uuid NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('manual','webhook','schedule')),
  trigger_ref text NOT NULL,
  idempotency_key text NOT NULL,
  root_task_id uuid NULL REFERENCES tasks (id),
  expires_at timestamptz NOT NULL,
  bound_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id, workspace_id),
  UNIQUE (tenant_id, workspace_id, idempotency_key),
  FOREIGN KEY (work_id, tenant_id, workspace_id)
    REFERENCES works (id, tenant_id, workspace_id),
  FOREIGN KEY (definition_version_id) REFERENCES team_versions (id),
  CHECK ((root_task_id IS NULL AND bound_at IS NULL)
      OR (root_task_id IS NOT NULL AND bound_at IS NOT NULL))
);

CREATE UNIQUE INDEX work_runs_root_task_bound_unique
  ON work_runs (root_task_id)
  WHERE root_task_id IS NOT NULL;

CREATE INDEX work_runs_workspace_list_idx
  ON work_runs (tenant_id, workspace_id, created_at DESC, id DESC)
  WHERE root_task_id IS NOT NULL;

CREATE INDEX works_workspace_list_idx
  ON works (tenant_id, workspace_id, created_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE INDEX work_runs_pending_expiry_idx
  ON work_runs (expires_at, id)
  WHERE root_task_id IS NULL;

CREATE TABLE work_run_resource_manifest (
  work_run_id uuid NOT NULL,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  slot text NOT NULL,
  resource_kind text NOT NULL CHECK (
    resource_kind IN ('definition','agent','environment','memory','skill')
  ),
  requested_ref text NULL,
  resolved_version_id uuid NOT NULL,
  resolved_fingerprint text NULL,
  resolved_at timestamptz NOT NULL,
  PRIMARY KEY (work_run_id, slot),
  FOREIGN KEY (work_run_id, tenant_id, workspace_id)
    REFERENCES work_runs (id, tenant_id, workspace_id)
);

COMMIT;
