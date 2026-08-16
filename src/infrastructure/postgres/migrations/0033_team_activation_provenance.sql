BEGIN;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS team_activation_materializer text NULL,
  ADD COLUMN IF NOT EXISTS team_activation_causes jsonb NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_team_activation_provenance_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_team_activation_provenance_check CHECK (
  (team_activation_materializer IS NULL AND team_activation_causes IS NULL)
  OR (
    team_activation_materializer = 'task_run_collaboration_activation_adapter'
    AND jsonb_typeof(team_activation_causes) = 'array'
    AND jsonb_array_length(team_activation_causes) > 0
  )
);

COMMIT;
