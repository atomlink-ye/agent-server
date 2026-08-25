BEGIN;

-- Formal Team child tasks invoke Worker versions. Keep 'agent' for the
-- historical direct-Agent task surface, but admit the new Worker kind.
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_invokable_kind_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_invokable_kind_check
  CHECK (invokable_kind IN ('agent', 'worker', 'team'));

-- 0058 backfilled the immutable Worker identity before this final cutover.
-- Formal Team execution now reads and writes only worker_version_id; keeping
-- the Agent column would preserve a second active participant authority.
ALTER TABLE team_member_runs
  DROP COLUMN IF EXISTS agent_version_id;

COMMIT;
