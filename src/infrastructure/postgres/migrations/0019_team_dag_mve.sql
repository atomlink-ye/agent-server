BEGIN;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check
  CHECK (status IN ('queued', 'running', 'waiting_children', 'succeeded', 'failed', 'timed_out', 'cancelled'));

-- AgentVersion ownership is tenant/principal scoped.  workspace_id remains on
-- session_launch_snapshots as immutable snapshot data, but is not part of the
-- AgentVersion ownership relationship.
CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_owner_scope_uq
  ON agent_versions (id, tenant_id, principal_type, principal_id);

DO $$
DECLARE
  constraint_name text;
BEGIN
  -- 0018 created this FK inline, so PostgreSQL generated its name. Find and
  -- replace only the FK from snapshots to agent_versions, regardless of that
  -- generated-name truncation.
  SELECT c.conname
    INTO constraint_name
    FROM pg_constraint AS c
   WHERE c.conrelid = 'session_launch_snapshots'::regclass
     AND c.confrelid = 'agent_versions'::regclass
     AND c.contype = 'f'
     AND c.conname <> 'session_launch_snapshots_agent_version_owner_fk'
     AND c.conkey::smallint[] = ARRAY[
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'agent_version_id'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'tenant_id'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'workspace_id'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'principal_type'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'principal_id')
     ]::smallint[]
     AND c.confkey::smallint[] = ARRAY[
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'id'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'tenant_id'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'workspace_id'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'principal_type'),
       (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'principal_id')
     ]::smallint[]
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE session_launch_snapshots DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS c
     WHERE c.conrelid = 'session_launch_snapshots'::regclass
       AND c.conname = 'session_launch_snapshots_agent_version_owner_fk'
       AND c.contype = 'f'
       AND c.conkey::smallint[] = ARRAY[
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'agent_version_id'),
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'tenant_id'),
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'principal_type'),
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'principal_id')
       ]::smallint[]
       AND c.confkey::smallint[] = ARRAY[
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'id'),
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'tenant_id'),
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'principal_type'),
         (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'principal_id')
       ]::smallint[]
  ) THEN
    ALTER TABLE session_launch_snapshots
      ADD CONSTRAINT session_launch_snapshots_agent_version_owner_fk
      FOREIGN KEY (agent_version_id, tenant_id, principal_type, principal_id)
      REFERENCES agent_versions (id, tenant_id, principal_type, principal_id);
  END IF;
END
$$;

ALTER TABLE team_versions ADD COLUMN IF NOT EXISTS environment_version_id uuid NULL;
ALTER TABLE compiled_team_plans ADD COLUMN IF NOT EXISTS environment_version_id uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS team_versions_environment_pin_uq
  ON team_versions (id, environment_version_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_versions_environment_owner_fk') THEN
    ALTER TABLE team_versions ADD CONSTRAINT team_versions_environment_owner_fk
      FOREIGN KEY (environment_version_id, tenant_id, principal_type, principal_id)
      REFERENCES environment_versions (id, tenant_id, principal_type, principal_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compiled_team_plans_environment_pin_fk') THEN
    ALTER TABLE compiled_team_plans ADD CONSTRAINT compiled_team_plans_environment_pin_fk
      FOREIGN KEY (team_version_id, environment_version_id)
      REFERENCES team_versions (id, environment_version_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS team_executions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL, workspace_id text NOT NULL, principal_type text NOT NULL, principal_id text NOT NULL,
  root_task_id uuid NOT NULL REFERENCES tasks(id), root_run_id uuid NOT NULL REFERENCES runs(id),
  team_version_id uuid NOT NULL, environment_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('running','waiting_children','succeeded','failed')),
  result text NULL CHECK (result IS NULL OR octet_length(result) <= 65536),
  failure_detail text NULL CHECK (failure_detail IS NULL OR octet_length(failure_detail) <= 8192),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (root_run_id), UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id),
  FOREIGN KEY (team_version_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_versions(id, tenant_id, workspace_id, principal_type, principal_id),
  FOREIGN KEY (environment_version_id, tenant_id, principal_type, principal_id)
    REFERENCES environment_versions(id, tenant_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS team_node_executions (
  id uuid PRIMARY KEY,
  team_execution_id uuid NOT NULL REFERENCES team_executions(id), node_id text NOT NULL,
  dependency_node_ids jsonb NOT NULL, child_task_id uuid NULL REFERENCES tasks(id), child_run_id uuid NULL REFERENCES runs(id),
  status text NOT NULL CHECK (status IN ('pending','queued','running','succeeded','failed','blocked')),
  result text NULL CHECK (result IS NULL OR octet_length(result) <= 32768),
  failure_detail text NULL CHECK (failure_detail IS NULL OR octet_length(failure_detail) <= 8192),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (team_execution_id, node_id), UNIQUE (team_execution_id, child_task_id),
  UNIQUE (team_execution_id, child_run_id)
);

ALTER TABLE runtime_sessions
  ALTER COLUMN scope_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS product_session_id uuid NULL,
  ADD COLUMN IF NOT EXISTS task_id uuid NULL;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'runtime_sessions'::regclass
    AND c.contype = 'f'
    AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'scope_id')]::smallint[];
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE runtime_sessions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE runtime_sessions
SET product_session_id = scope_id
WHERE scope_kind = 'product_session' AND product_session_id IS NULL;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'runtime_sessions'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%scope_kind%product_session%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE runtime_sessions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE runtime_sessions
  DROP CONSTRAINT IF EXISTS runtime_sessions_scope_shape_check,
  DROP CONSTRAINT IF EXISTS runtime_sessions_scope_kind_check,
  ADD CONSTRAINT runtime_sessions_scope_shape_check CHECK (
    (scope_kind = 'product_session' AND product_session_id IS NOT NULL AND task_id IS NULL)
    OR (scope_kind = 'task' AND product_session_id IS NULL AND task_id IS NOT NULL)
  ),
  ADD CONSTRAINT runtime_sessions_scope_kind_check CHECK (scope_kind IN ('product_session', 'task'));

ALTER TABLE runtime_sessions
  ADD CONSTRAINT runtime_sessions_product_session_fk FOREIGN KEY (product_session_id) REFERENCES product_sessions(id),
  ADD CONSTRAINT runtime_sessions_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id);

CREATE UNIQUE INDEX IF NOT EXISTS runtime_sessions_product_session_uq
  ON runtime_sessions (product_session_id) WHERE product_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS runtime_sessions_task_uq
  ON runtime_sessions (task_id) WHERE task_id IS NOT NULL;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_state_check;
ALTER TABLE runs ADD CONSTRAINT runs_state_check CHECK (
  (status = 'queued' AND lease_owner IS NULL AND activation_id IS NULL AND lease_expires_at IS NULL AND result IS NULL AND error IS NULL AND fencing_token = 0)
  OR (status = 'running' AND lease_owner IS NOT NULL AND activation_id IS NOT NULL AND lease_expires_at IS NOT NULL AND result IS NULL AND error IS NULL AND fencing_token > 0)
  OR (status = 'waiting_children' AND lease_owner IS NULL AND activation_id IS NULL AND lease_expires_at IS NULL AND result IS NULL AND error IS NULL AND fencing_token > 0)
  OR (status = 'succeeded' AND lease_owner IS NULL AND activation_id IS NULL AND lease_expires_at IS NULL AND result IS NOT NULL AND error IS NULL AND fencing_token > 0)
  OR (status IN ('failed','timed_out') AND lease_owner IS NULL AND activation_id IS NULL AND lease_expires_at IS NULL AND result IS NULL AND error IS NOT NULL AND fencing_token > 0)
  OR (status = 'cancelled' AND lease_owner IS NULL AND activation_id IS NULL AND lease_expires_at IS NULL AND result IS NULL AND error IS NOT NULL AND fencing_token >= 0)
);

COMMIT;
