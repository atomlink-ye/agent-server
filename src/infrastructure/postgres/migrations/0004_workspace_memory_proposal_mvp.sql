BEGIN;

CREATE TABLE IF NOT EXISTS workspace_memory_proposals (
  internal_order bigserial NOT NULL UNIQUE,
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  original_content text NOT NULL,
  original_category text NOT NULL,
  source_task_id uuid NULL,
  source_session_id text NULL,
  proposer_snapshot jsonb NOT NULL,
  status text NOT NULL,
  review_outcome text NULL,
  reviewed_content text NULL,
  reviewer_snapshot jsonb NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT workspace_memory_proposals_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT workspace_memory_proposals_review_outcome_check
    CHECK (review_outcome IS NULL OR review_outcome IN ('accept', 'edit_and_accept', 'reject')),
  CONSTRAINT workspace_memory_proposals_pending_review_shape_check
    CHECK (
      (status = 'pending' AND review_outcome IS NULL AND reviewed_content IS NULL AND reviewer_snapshot IS NULL AND reviewed_at IS NULL)
      OR
      (status <> 'pending' AND review_outcome IS NOT NULL AND reviewer_snapshot IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
  CONSTRAINT workspace_memory_proposals_status_outcome_check
    CHECK (
      (status = 'pending' AND review_outcome IS NULL)
      OR (status = 'accepted' AND review_outcome IN ('accept', 'edit_and_accept'))
      OR (status = 'rejected' AND review_outcome = 'reject')
    ),
  CONSTRAINT workspace_memory_proposals_reviewed_content_check
    CHECK (
      (review_outcome = 'edit_and_accept' AND reviewed_content IS NOT NULL AND length(btrim(reviewed_content)) > 0)
      OR (review_outcome IS DISTINCT FROM 'edit_and_accept' AND reviewed_content IS NULL)
    ),
  CONSTRAINT workspace_memory_proposals_timestamp_order_check
    CHECK (updated_at >= created_at),
  CONSTRAINT workspace_memory_proposals_original_content_check
    CHECK (length(btrim(original_content)) > 0),
  CONSTRAINT workspace_memory_proposals_original_category_check
    CHECK (length(btrim(original_category)) > 0),
  CONSTRAINT workspace_memory_proposals_owner_scope_check
    CHECK (
      length(btrim(tenant_id)) > 0 AND
      length(btrim(workspace_id)) > 0 AND
      length(btrim(principal_type)) > 0 AND
      length(btrim(principal_id)) > 0
    ),
  CONSTRAINT workspace_memory_proposals_owner_scope_unique
    UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS workspace_memory_proposals_owner_created_idx
  ON workspace_memory_proposals (tenant_id, workspace_id, principal_type, principal_id, created_at DESC, internal_order DESC);

CREATE TABLE IF NOT EXISTS workspace_memory_entries (
  internal_order bigserial NOT NULL UNIQUE,
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES workspace_memory_proposals(id),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  content text NOT NULL,
  category text NOT NULL,
  source_task_id uuid NULL,
  source_session_id text NULL,
  proposer_snapshot jsonb NOT NULL,
  reviewer_snapshot jsonb NOT NULL,
  review_outcome text NOT NULL,
  accepted_at timestamptz NOT NULL,
  CONSTRAINT workspace_memory_entries_review_outcome_check
    CHECK (review_outcome IN ('accept', 'edit_and_accept')),
  CONSTRAINT workspace_memory_entries_content_check
    CHECK (length(btrim(content)) > 0),
  CONSTRAINT workspace_memory_entries_category_check
    CHECK (length(btrim(category)) > 0),
  CONSTRAINT workspace_memory_entries_owner_scope_check
    CHECK (
      length(btrim(tenant_id)) > 0 AND
      length(btrim(workspace_id)) > 0 AND
      length(btrim(principal_type)) > 0 AND
      length(btrim(principal_id)) > 0
    ),
  CONSTRAINT workspace_memory_entries_proposal_owner_scope_fk
    FOREIGN KEY (proposal_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES workspace_memory_proposals (id, tenant_id, workspace_id, principal_type, principal_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_memory_entries_proposal_unique_idx
  ON workspace_memory_entries (proposal_id);

CREATE INDEX IF NOT EXISTS workspace_memory_entries_owner_accepted_idx
  ON workspace_memory_entries (tenant_id, workspace_id, principal_type, principal_id, accepted_at DESC, internal_order DESC);

COMMIT;
