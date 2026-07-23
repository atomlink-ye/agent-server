BEGIN;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_message_id text NULL;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_run_id uuid NULL;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_agent_version_id uuid NULL;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_candidate_index integer NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_message_id text NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_run_id uuid NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_agent_version_id uuid NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_candidate_index integer NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_memory_proposals_runtime_replay
  ON workspace_memory_proposals(source_run_id, source_candidate_index)
  WHERE source_run_id IS NOT NULL AND source_candidate_index IS NOT NULL;
COMMIT;
