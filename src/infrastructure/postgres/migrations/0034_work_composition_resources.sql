BEGIN;

-- Product Work can now bind either a published ManagedAgent version or a
-- published Team version. Cross-registry lineage is validated deterministically
-- by the Work Definition resolver before these IDs are persisted, so the
-- Team-only foreign keys must no longer encode product semantics.
ALTER TABLE works
  DROP CONSTRAINT IF EXISTS works_definition_id_fkey;
ALTER TABLE works
  DROP CONSTRAINT IF EXISTS works_current_definition_version_id_fkey;
ALTER TABLE work_runs
  DROP CONSTRAINT IF EXISTS work_runs_definition_version_id_fkey;

-- Resolved manifests include immutable version IDs as well as stable Skill,
-- Tool, and platform-capability references. Keep one textual identity column
-- rather than forcing non-registry resources into UUID-shaped values.
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
