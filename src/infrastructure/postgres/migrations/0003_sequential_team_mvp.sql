BEGIN;

CREATE TABLE IF NOT EXISTS agent_definitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  name text NOT NULL,
  description text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT agent_definitions_updated_after_created_check CHECK (updated_at >= created_at),
  UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS agent_versions (
  id uuid PRIMARY KEY,
  definition_id uuid NOT NULL REFERENCES agent_definitions(id),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  name text NOT NULL,
  description text NULL,
  instructions text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz NULL,
  CONSTRAINT agent_versions_updated_after_created_check CHECK (updated_at >= created_at),
  CONSTRAINT agent_versions_published_shape_check CHECK (
    (
      status = 'draft'
      AND published_at IS NULL
    ) OR (
      status = 'published'
      AND published_at IS NOT NULL
      AND updated_at >= published_at
      AND published_at >= created_at
    )
  ),
  UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_versions_definition_scope_fk'
  ) THEN
    ALTER TABLE agent_versions
      ADD CONSTRAINT agent_versions_definition_scope_fk
      FOREIGN KEY (
        definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      )
      REFERENCES agent_definitions(
        id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS team_definitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  name text NOT NULL,
  description text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT team_definitions_updated_after_created_check CHECK (updated_at >= created_at),
  UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS team_versions (
  id uuid PRIMARY KEY,
  definition_id uuid NOT NULL REFERENCES team_definitions(id),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  name text NOT NULL,
  description text NULL,
  graph jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz NULL,
  CONSTRAINT team_versions_updated_after_created_check CHECK (updated_at >= created_at),
  CONSTRAINT team_versions_published_shape_check CHECK (
    (
      status = 'draft'
      AND published_at IS NULL
    ) OR (
      status = 'published'
      AND published_at IS NOT NULL
      AND updated_at >= published_at
      AND published_at >= created_at
    )
  ),
  UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_versions_definition_scope_fk'
  ) THEN
    ALTER TABLE team_versions
      ADD CONSTRAINT team_versions_definition_scope_fk
      FOREIGN KEY (
        definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      )
      REFERENCES team_definitions(
        id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS compiled_team_plans (
  team_version_id uuid PRIMARY KEY REFERENCES team_versions(id),
  compiler_version text NOT NULL,
  entry_node_id text NOT NULL,
  final_output_node_id text NOT NULL,
  compiled_at timestamptz NOT NULL,
  steps jsonb NOT NULL
);

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_invokable_kind_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_invokable_kind_check
  CHECK (invokable_kind IN ('agent', 'team'));

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS logical_step_key text NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS node_path text NULL;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_step_identity_shape_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_step_identity_shape_check
  CHECK (
    (
      depth = 0
      AND logical_step_key IS NULL
      AND node_path IS NULL
    ) OR (
      depth > 0
      AND logical_step_key IS NOT NULL
      AND btrim(logical_step_key) <> ''
      AND node_path IS NOT NULL
      AND btrim(node_path) <> ''
    )
  );

CREATE OR REPLACE FUNCTION prevent_published_invokable_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Published invokable versions are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'agent_versions_immutable_before_update'
  ) THEN
    CREATE TRIGGER agent_versions_immutable_before_update
    BEFORE UPDATE ON agent_versions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_published_invokable_version_mutation();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'team_versions_immutable_before_update'
  ) THEN
    CREATE TRIGGER team_versions_immutable_before_update
    BEFORE UPDATE ON team_versions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_published_invokable_version_mutation();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION prevent_compiled_team_plan_mutation()
RETURNS trigger AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Compiled team plans are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'compiled_team_plans_immutable_before_update'
  ) THEN
    CREATE TRIGGER compiled_team_plans_immutable_before_update
    BEFORE UPDATE ON compiled_team_plans
    FOR EACH ROW
    EXECUTE FUNCTION prevent_compiled_team_plan_mutation();
  END IF;
END
$$;

COMMIT;
