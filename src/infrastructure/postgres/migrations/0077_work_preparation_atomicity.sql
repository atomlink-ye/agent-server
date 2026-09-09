BEGIN;

ALTER TABLE work_preparations
  ADD COLUMN IF NOT EXISTS source_message_id uuid NULL;
ALTER TABLE work_chat_messages
  ADD COLUMN IF NOT EXISTS preparation_id uuid NULL,
  ADD COLUMN IF NOT EXISTS work_run_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_runs_owner_work_unique'
  ) THEN
    ALTER TABLE work_runs
      ADD CONSTRAINT work_runs_owner_work_unique
      UNIQUE (id, tenant_id, workspace_id, work_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_preparations_owner_work_unique'
  ) THEN
    ALTER TABLE work_preparations
      ADD CONSTRAINT work_preparations_owner_work_unique
      UNIQUE (id, tenant_id, workspace_id, work_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_preparations_started_shape_check'
  ) THEN
    ALTER TABLE work_preparations
      ADD CONSTRAINT work_preparations_started_shape_check
      CHECK (status <> 'started' OR (work_run_id IS NOT NULL AND start_intent IS NOT NULL AND confirmed_fingerprint IS NOT NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_preparations_starting_shape_check'
  ) THEN
    ALTER TABLE work_preparations
      ADD CONSTRAINT work_preparations_starting_shape_check
      CHECK (status <> 'starting' OR (start_intent IS NOT NULL AND confirmed_fingerprint IS NOT NULL));
  END IF;
END
$$;

ALTER TABLE work_preparations
  DROP CONSTRAINT IF EXISTS work_preparations_work_run_id_tenant_id_workspace_id_fkey;
ALTER TABLE work_preparations
  ADD CONSTRAINT work_preparations_work_run_owner_work_fkey
  FOREIGN KEY (work_run_id, tenant_id, workspace_id, work_id)
  REFERENCES work_runs(id, tenant_id, workspace_id, work_id);

ALTER TABLE work_chat_messages
  DROP CONSTRAINT IF EXISTS work_chat_messages_preparation_fk;
ALTER TABLE work_chat_messages
  ADD CONSTRAINT work_chat_messages_preparation_owner_work_fkey
  FOREIGN KEY (preparation_id, tenant_id, workspace_id, work_id)
  REFERENCES work_preparations(id, tenant_id, workspace_id, work_id);
ALTER TABLE work_chat_messages
  DROP CONSTRAINT IF EXISTS work_chat_messages_work_run_fk;
ALTER TABLE work_chat_messages
  ADD CONSTRAINT work_chat_messages_work_run_owner_work_fkey
  FOREIGN KEY (work_run_id, tenant_id, workspace_id, work_id)
  REFERENCES work_runs(id, tenant_id, workspace_id, work_id);

CREATE UNIQUE INDEX IF NOT EXISTS work_preparations_source_message_unique
  ON work_preparations (tenant_id, workspace_id, work_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

COMMIT;

