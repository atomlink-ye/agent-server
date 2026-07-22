BEGIN;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS workspace_id text;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS principal_type text;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS principal_id text;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS policy_snapshot_version text;

UPDATE tasks
SET
  workspace_id = COALESCE(workspace_id, 'workspace_local'),
  principal_type = COALESCE(principal_type, 'service_account'),
  principal_id = COALESCE(principal_id, 'compatibility_local'),
  policy_snapshot_version = COALESCE(
    policy_snapshot_version,
    'policy_compatibility_local'
  )
WHERE workspace_id IS NULL
  OR principal_type IS NULL
  OR principal_id IS NULL
  OR policy_snapshot_version IS NULL;

ALTER TABLE tasks
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE tasks
  ALTER COLUMN principal_type SET NOT NULL;

ALTER TABLE tasks
  ALTER COLUMN principal_id SET NOT NULL;

ALTER TABLE tasks
  ALTER COLUMN policy_snapshot_version SET NOT NULL;

ALTER TABLE admissions
  ADD COLUMN IF NOT EXISTS tenant_id text;

ALTER TABLE admissions
  ADD COLUMN IF NOT EXISTS workspace_id text;

ALTER TABLE admissions
  ADD COLUMN IF NOT EXISTS principal_type text;

ALTER TABLE admissions
  ADD COLUMN IF NOT EXISTS principal_id text;

ALTER TABLE admissions
  ADD COLUMN IF NOT EXISTS policy_snapshot_version text;

UPDATE admissions
SET
  tenant_id = tasks.tenant_id,
  workspace_id = tasks.workspace_id,
  principal_type = tasks.principal_type,
  principal_id = tasks.principal_id,
  policy_snapshot_version = tasks.policy_snapshot_version
FROM tasks
WHERE tasks.id = admissions.task_id
  AND (
    admissions.tenant_id IS NULL
    OR admissions.workspace_id IS NULL
    OR admissions.principal_type IS NULL
    OR admissions.principal_id IS NULL
    OR admissions.policy_snapshot_version IS NULL
  );

ALTER TABLE admissions
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE admissions
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE admissions
  ALTER COLUMN principal_type SET NOT NULL;

ALTER TABLE admissions
  ALTER COLUMN principal_id SET NOT NULL;

ALTER TABLE admissions
  ALTER COLUMN policy_snapshot_version SET NOT NULL;

ALTER TABLE admissions
  DROP CONSTRAINT IF EXISTS admissions_ingress_idempotency_key_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admissions_owner_scope_idempotency_key_key'
  ) THEN
    ALTER TABLE admissions
      ADD CONSTRAINT admissions_owner_scope_idempotency_key_key
      UNIQUE (
        ingress,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id,
        idempotency_key
      );
  END IF;
END
$$;

COMMIT;
