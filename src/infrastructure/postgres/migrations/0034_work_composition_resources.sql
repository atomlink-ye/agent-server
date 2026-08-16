BEGIN;

-- Product Work may bind a published ManagedAgent version or a published Team
-- version. The composition resolver validates owner scope and lineage before
-- persistence, so Team-only foreign keys must not encode product semantics.
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
