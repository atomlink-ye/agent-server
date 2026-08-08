BEGIN;

ALTER TABLE team_runs
  ADD COLUMN IF NOT EXISTS completion_approval_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS team_completion_decisions (
  id uuid PRIMARY KEY,
  team_run_id uuid NOT NULL,
  completion_requested_by_run_id uuid NOT NULL REFERENCES runs(id),
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  feedback text NULL,
  decided_by text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at timestamptz NOT NULL,
  team_revision_at_decision integer NOT NULL CHECK (team_revision_at_decision >= 0),
  lead_turn_count_at_decision integer NOT NULL CHECK (lead_turn_count_at_decision >= 0),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  CONSTRAINT team_completion_decisions_shape_check CHECK (
    (decision = 'approve' AND feedback IS NULL)
    OR (decision = 'reject' AND feedback IS NOT NULL AND btrim(feedback) <> '')
  ),
  CONSTRAINT team_completion_decisions_team_owner_fk
    FOREIGN KEY (team_run_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_runs (id, tenant_id, workspace_id, principal_type, principal_id),
  CONSTRAINT team_completion_decisions_request_unique
    UNIQUE (team_run_id, completion_requested_by_run_id),
  CONSTRAINT team_completion_decisions_revision_unique
    UNIQUE (team_run_id, team_revision_at_decision),
  CONSTRAINT team_completion_decisions_id_owner_unique
    UNIQUE (id, team_run_id, tenant_id, workspace_id, principal_type, principal_id)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_work_item_attempts_snapshot_owner_unique'
      AND conrelid = 'team_work_item_attempts'::regclass
  ) THEN
    ALTER TABLE team_work_item_attempts
      ADD CONSTRAINT team_work_item_attempts_snapshot_owner_unique
      UNIQUE (work_item_id, team_run_id, attempt_no, tenant_id, workspace_id, principal_type, principal_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_completion_decision_targets (
  decision_id uuid NOT NULL,
  team_run_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  attempt_no_at_decision integer NOT NULL CHECK (attempt_no_at_decision > 0),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  PRIMARY KEY (decision_id, ordinal),
  CONSTRAINT team_completion_decision_targets_work_unique
    UNIQUE (decision_id, work_item_id),
  CONSTRAINT team_completion_decision_targets_decision_fk
    FOREIGN KEY (decision_id, team_run_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_completion_decisions (id, team_run_id, tenant_id, workspace_id, principal_type, principal_id),
  CONSTRAINT team_completion_decision_targets_work_owner_fk
    FOREIGN KEY (work_item_id, team_run_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_work_items (id, team_run_id, tenant_id, workspace_id, principal_type, principal_id),
  CONSTRAINT team_completion_decision_targets_attempt_snapshot_fk
    FOREIGN KEY (work_item_id, team_run_id, attempt_no_at_decision, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES team_work_item_attempts (work_item_id, team_run_id, attempt_no, tenant_id, workspace_id, principal_type, principal_id)
);

CREATE OR REPLACE FUNCTION prevent_team_completion_decision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Team completion decisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_team_completion_decision_request()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM team_runs team
      JOIN tasks task
        ON task.root_task_id = team.root_task_id
       AND task.parent_run_id = team.root_run_id
       AND task.team_task_kind = 'lead_turn'
      JOIN team_member_runs lead_member
        ON lead_member.id = task.team_member_run_id
       AND lead_member.team_run_id = team.id
       AND lead_member.role = 'lead'
       AND lead_member.tenant_id = team.tenant_id
       AND lead_member.workspace_id = team.workspace_id
       AND lead_member.principal_type = team.principal_type
       AND lead_member.principal_id = team.principal_id
     JOIN runs request_run
        ON request_run.id = NEW.completion_requested_by_run_id
       AND request_run.task_id = task.id
       AND request_run.status = 'succeeded'
     WHERE team.id = NEW.team_run_id
       AND team.tenant_id = NEW.tenant_id
       AND team.workspace_id = NEW.workspace_id
       AND team.principal_type = NEW.principal_type
       AND team.principal_id = NEW.principal_id
       AND task.tenant_id = NEW.tenant_id
       AND task.workspace_id = NEW.workspace_id
       AND task.principal_type = NEW.principal_type
       AND task.principal_id = NEW.principal_id
       AND team.completion_requested_by_run_id = NEW.completion_requested_by_run_id
       AND team.revision = NEW.team_revision_at_decision
       AND team.lead_turn_count = NEW.lead_turn_count_at_decision
  ) THEN
    RAISE EXCEPTION 'Completion request run is not owned by the Team Lead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_completion_decisions_request_validation ON team_completion_decisions;
CREATE TRIGGER team_completion_decisions_request_validation
  BEFORE INSERT ON team_completion_decisions
  FOR EACH ROW EXECUTE FUNCTION validate_team_completion_decision_request();

CREATE OR REPLACE FUNCTION validate_team_completion_decision_target_shape()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM team_completion_decisions decision
     WHERE decision.id = NEW.decision_id
       AND decision.decision = 'approve'
  ) THEN
    RAISE EXCEPTION 'Approved team completion decisions cannot have targets';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_completion_decision_targets_shape ON team_completion_decision_targets;
CREATE TRIGGER team_completion_decision_targets_shape
  BEFORE INSERT ON team_completion_decision_targets
  FOR EACH ROW EXECUTE FUNCTION validate_team_completion_decision_target_shape();

DROP TRIGGER IF EXISTS team_completion_decisions_immutable_update ON team_completion_decisions;
CREATE TRIGGER team_completion_decisions_immutable_update
  BEFORE UPDATE OR DELETE ON team_completion_decisions
  FOR EACH ROW EXECUTE FUNCTION prevent_team_completion_decision_mutation();

DROP TRIGGER IF EXISTS team_completion_decision_targets_immutable_update ON team_completion_decision_targets;
CREATE TRIGGER team_completion_decision_targets_immutable_update
  BEFORE UPDATE OR DELETE ON team_completion_decision_targets
  FOR EACH ROW EXECUTE FUNCTION prevent_team_completion_decision_mutation();

COMMIT;
