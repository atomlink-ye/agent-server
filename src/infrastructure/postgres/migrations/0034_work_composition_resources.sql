BEGIN;

-- The compiler-facing Definition source is deliberately small: it stores only
-- immutable version refs and lets the resolver derive participant/Skill/Tool
-- details from those exact versions. A later public Definition API can publish
-- through this table without changing the execution core.
CREATE TABLE IF NOT EXISTS work_definition_source_definitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  name text NOT NULL,
  description text NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(id,tenant_id,workspace_id,principal_type,principal_id),
  FOREIGN KEY (workspace_id,tenant_id,principal_type,principal_id)
    REFERENCES workspaces(id,tenant_id,principal_type,principal_id)
);

CREATE TABLE IF NOT EXISTS work_definition_source_versions (
  id uuid PRIMARY KEY,
  definition_id uuid NOT NULL,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  status text NOT NULL CHECK(status='published'),
  source jsonb NOT NULL,
  fingerprint text NOT NULL CHECK(fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  UNIQUE(definition_id,fingerprint),
  UNIQUE(id,definition_id,tenant_id,workspace_id,principal_type,principal_id),
  FOREIGN KEY (definition_id,tenant_id,workspace_id,principal_type,principal_id)
    REFERENCES work_definition_source_definitions(
      id,tenant_id,workspace_id,principal_type,principal_id
    )
);

CREATE OR REPLACE FUNCTION prevent_work_definition_source_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published Work Definition source versions are immutable';
END;
$$;
DROP TRIGGER IF EXISTS work_definition_source_versions_immutable_trg
  ON work_definition_source_versions;
CREATE TRIGGER work_definition_source_versions_immutable_trg
  BEFORE UPDATE OR DELETE ON work_definition_source_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_work_definition_source_version_mutation();

-- Product Work may bind a published Work Definition source version, a legacy
-- ManagedAgent version, or a legacy Team version. The composition resolver owns
-- lineage validation, so Team-only foreign keys must not encode product semantics.
ALTER TABLE works
  DROP CONSTRAINT IF EXISTS works_definition_id_fkey;
ALTER TABLE works
  DROP CONSTRAINT IF EXISTS works_current_definition_version_id_fkey;
ALTER TABLE work_runs
  DROP CONSTRAINT IF EXISTS work_runs_definition_version_id_fkey;

-- A resolved manifest contains immutable registry versions plus stable Skill,
-- domain Tool, and platform-capability identities. Those latter references are
-- intentionally textual rather than forced into UUID-shaped identities.
ALTER TABLE work_run_resource_manifest
  DROP CONSTRAINT IF EXISTS work_run_resource_manifest_resource_kind_check;
ALTER TABLE work_run_resource_manifest
  ALTER COLUMN resolved_version_id TYPE text
  USING resolved_version_id::text;
ALTER TABLE work_run_resource_manifest
  ADD CONSTRAINT work_run_resource_manifest_resource_kind_check CHECK (
    resource_kind IN (
      'definition',
      'agent',
      'environment',
      'memory',
      'skill',
      'tool',
      'platform_capability'
    )
  );

COMMIT;
