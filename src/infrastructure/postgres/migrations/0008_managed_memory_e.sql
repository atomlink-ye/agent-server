BEGIN;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS memory_snapshot_id uuid NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS memory_snapshot_hash text NULL;
CREATE TABLE IF NOT EXISTS workspace_memory_owned_entries (
  entry_id uuid PRIMARY KEY, proposal_id uuid NOT NULL UNIQUE, tenant_id text NOT NULL, workspace_id text NOT NULL,
  content text NOT NULL, content_hash text NOT NULL, category text NOT NULL, source_task_id uuid, source_session_id text,
  source_message_id uuid, source_run_id uuid, source_agent_version_id uuid, source_candidate_index integer,
  proposer_snapshot jsonb NOT NULL, reviewer_snapshot jsonb NOT NULL, accepted_at timestamptz NOT NULL,
  CHECK (source_run_id IS NULL OR (source_candidate_index IS NOT NULL AND source_task_id IS NOT NULL AND source_agent_version_id IS NOT NULL)),
  CHECK (source_candidate_index IS NULL OR source_candidate_index >= 0)
);
CREATE INDEX IF NOT EXISTS workspace_memory_owned_entries_order ON workspace_memory_owned_entries(tenant_id, workspace_id, accepted_at, entry_id);
CREATE TABLE IF NOT EXISTS workspace_memory_snapshots (
  snapshot_id uuid PRIMARY KEY, tenant_id text NOT NULL, workspace_id text NOT NULL, version bigint NOT NULL,
  content_hash text NOT NULL, manifest_hash text NOT NULL, projection_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id, workspace_id, version),
  CHECK (projection_status IN ('pending','ready','failed'))
);
CREATE INDEX IF NOT EXISTS workspace_memory_snapshots_scope ON workspace_memory_snapshots(tenant_id, workspace_id, version DESC);
COMMIT;
