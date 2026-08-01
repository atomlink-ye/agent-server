BEGIN;

CREATE TABLE IF NOT EXISTS learning_proposals (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  source_team_run_id uuid NOT NULL REFERENCES team_runs(id),
  source_task_id uuid NOT NULL REFERENCES tasks(id),
  source_run_id uuid NOT NULL REFERENCES runs(id),
  target_memory_store_id uuid NOT NULL REFERENCES memory_stores(id),
  target_memory_id uuid NOT NULL REFERENCES memories(id),
  target_path text NOT NULL CHECK (length(target_path) BETWEEN 1 AND 512),
  base_content_sha256 text NOT NULL CHECK (base_content_sha256 ~ '^[0-9a-f]{64}$'),
  proposed_content text NOT NULL CHECK (octet_length(proposed_content) BETWEEN 1 AND 8192),
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) BETWEEN 1 AND 8),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  accepted_memory_version_id uuid NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, tenant_id, principal_type, principal_id)
    REFERENCES workspaces(id, tenant_id, principal_type, principal_id),
  FOREIGN KEY (accepted_memory_version_id, target_memory_id)
    REFERENCES memory_versions(id, memory_id),
  CONSTRAINT learning_proposals_status_shape_check CHECK (
    (status = 'pending' AND accepted_memory_version_id IS NULL AND reviewed_at IS NULL)
    OR (status = 'accepted' AND accepted_memory_version_id IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status = 'rejected' AND accepted_memory_version_id IS NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT learning_proposals_timestamps_check CHECK (updated_at >= created_at AND (reviewed_at IS NULL OR reviewed_at >= created_at))
);

CREATE INDEX IF NOT EXISTS learning_proposals_owner_created_idx
  ON learning_proposals (tenant_id, workspace_id, principal_type, principal_id, created_at DESC, id DESC);

COMMIT;
