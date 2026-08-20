BEGIN;

ALTER TABLE work_runs
  ADD COLUMN IF NOT EXISTS predecessor_work_run_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'work_runs_predecessor_scope_fkey'
  ) THEN
    ALTER TABLE work_runs
      ADD CONSTRAINT work_runs_predecessor_scope_fkey
      FOREIGN KEY (predecessor_work_run_id, tenant_id, workspace_id)
      REFERENCES work_runs (id, tenant_id, workspace_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS work_runs_predecessor_scope_idx
  ON work_runs (predecessor_work_run_id, tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS conversation_work_links_recent_idx
  ON conversation_work_links
    (tenant_id, workspace_id, conversation_id, created_at DESC, work_id DESC);

COMMIT;
