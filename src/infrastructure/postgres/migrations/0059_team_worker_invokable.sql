BEGIN;

-- Formal Team child tasks invoke Worker versions. Keep 'agent' for the
-- historical direct-Agent task surface, but admit the new Worker kind.
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_invokable_kind_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_invokable_kind_check
  CHECK (invokable_kind IN ('agent', 'worker', 'team'));

-- 0058 backfilled the immutable Worker identity before this final cutover.
-- Formal Team execution now reads and writes only worker_version_id; keeping
-- the Agent column would preserve a second active participant authority.
ALTER TABLE team_member_runs
  DROP COLUMN IF EXISTS agent_version_id CASCADE;

ALTER TABLE runtime_session_specs
  ADD COLUMN IF NOT EXISTS subject_kind text NOT NULL DEFAULT 'agent_chat'
    CHECK (subject_kind IN ('agent_chat', 'worker', 'legacy_agent_task')),
  ADD COLUMN IF NOT EXISTS worker_version_id uuid NULL;

ALTER TABLE runtime_session_specs
  ALTER COLUMN agent_version_id DROP NOT NULL;

ALTER TABLE runtime_session_specs
  ADD CONSTRAINT runtime_session_specs_subject_shape_check
  CHECK (
    (subject_kind = 'worker' AND worker_version_id IS NOT NULL AND agent_version_id IS NULL)
    OR (subject_kind IN ('agent_chat', 'legacy_agent_task') AND agent_version_id IS NOT NULL AND worker_version_id IS NULL)
  );

CREATE TABLE agent_work_bindings (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_definition_id uuid NOT NULL,
  work_definition_id uuid NOT NULL REFERENCES work_definition_source_definitions(id),
  active_work_definition_version_id uuid NOT NULL REFERENCES work_definition_source_versions(id),
  status text NOT NULL CHECK (status IN ('enabled','disabled')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,workspace_id,agent_definition_id,work_definition_id)
);

COMMIT;
