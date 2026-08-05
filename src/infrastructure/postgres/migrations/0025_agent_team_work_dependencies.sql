BEGIN;

-- Owner scope is part of every dependency relation.  The composite foreign
-- keys prevent a work item from being attached to another TeamRun or tenant.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_runs_id_owner_unique'
      AND conrelid = 'team_runs'::regclass
  ) THEN
    ALTER TABLE team_runs
      ADD CONSTRAINT team_runs_id_owner_unique
      UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_work_items_id_team_owner_unique'
      AND conrelid = 'team_work_items'::regclass
  ) THEN
    ALTER TABLE team_work_items
      ADD CONSTRAINT team_work_items_id_team_owner_unique
      UNIQUE (id, team_run_id, tenant_id, workspace_id, principal_type, principal_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_work_item_dependencies (
  team_run_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  depends_on_work_item_id uuid NOT NULL,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_work_item_dependencies_self_edge_check
    CHECK (work_item_id <> depends_on_work_item_id),
  CONSTRAINT team_work_item_dependencies_unique
    UNIQUE (team_run_id, work_item_id, depends_on_work_item_id),
  CONSTRAINT team_work_item_dependencies_team_owner_fk
    FOREIGN KEY (team_run_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_runs (id, tenant_id, workspace_id, principal_type, principal_id),
  CONSTRAINT team_work_item_dependencies_work_owner_fk
    FOREIGN KEY (work_item_id, team_run_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_work_items (id, team_run_id, tenant_id, workspace_id, principal_type, principal_id),
  CONSTRAINT team_work_item_dependencies_depends_on_owner_fk
    FOREIGN KEY (depends_on_work_item_id, team_run_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_work_items (id, team_run_id, tenant_id, workspace_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS team_work_item_dependencies_claim_idx
  ON team_work_item_dependencies (team_run_id, work_item_id);

ALTER TABLE team_messages DROP CONSTRAINT team_messages_kind_check;
ALTER TABLE team_messages
  ADD CONSTRAINT team_messages_kind_check
  CHECK (kind IN ('wake', 'work_update', 'direct'));
ALTER TABLE team_messages DROP CONSTRAINT team_messages_status_check;
ALTER TABLE team_messages
  ADD CONSTRAINT team_messages_status_check
  CHECK (status IN ('queued', 'consumed', 'delivered', 'read'));
ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_kind_status_check;
ALTER TABLE team_messages
  ADD CONSTRAINT team_messages_kind_status_check CHECK (
    (
      kind IN ('wake', 'work_update')
      AND (
        (status = 'queued' AND consumed_by_task_id IS NULL AND consumed_at IS NULL)
        OR
        (status = 'consumed' AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL)
      )
    )
    OR
    (
      kind = 'direct'
      AND (
        (status = 'queued' AND consumed_by_task_id IS NULL AND consumed_at IS NULL)
        OR
        (status IN ('consumed','delivered','read') AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL)
      )
    )
  );

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_team_task_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_team_task_kind_check CHECK
  (team_task_kind IS NULL OR team_task_kind IN ('lead_turn','work_attempt','direct_message'));

COMMIT;
