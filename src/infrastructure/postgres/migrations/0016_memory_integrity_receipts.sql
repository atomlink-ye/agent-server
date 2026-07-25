BEGIN;

ALTER TABLE workspace_memory_proposals
  ADD COLUMN IF NOT EXISTS review_controller_ingress_id text NULL,
  ADD COLUMN IF NOT EXISTS review_decision_sha256 text NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_proposals_review_controller_fk') THEN
    ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_review_controller_fk
      FOREIGN KEY (review_controller_ingress_id) REFERENCES channel_ingress_events(id);
  END IF;
END $$;
ALTER TABLE workspace_memory_proposals DROP CONSTRAINT IF EXISTS workspace_memory_proposals_review_controller_shape_check;
ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_review_controller_shape_check CHECK (
  (review_controller_ingress_id IS NULL AND review_decision_sha256 IS NULL)
  OR (review_controller_ingress_id IS NOT NULL AND review_decision_sha256 IS NOT NULL
      AND review_decision_sha256 ~ '^[0-9a-f]{64}$' AND status <> 'pending')
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_memory_proposals_review_controller_unique
  ON workspace_memory_proposals(review_controller_ingress_id)
  WHERE review_controller_ingress_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_memory_projection_scopes (
  tenant_id text NOT NULL, workspace_id text NOT NULL, next_version bigint NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id), CHECK (next_version > 0)
);
LOCK TABLE workspace_memory_snapshots IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO workspace_memory_projection_scopes (tenant_id, workspace_id, next_version)
SELECT tenant_id, workspace_id, COALESCE(MAX(version), 0) + 1
FROM workspace_memory_snapshots GROUP BY tenant_id, workspace_id
ON CONFLICT (tenant_id, workspace_id) DO NOTHING;

ALTER TABLE workspace_memory_owned_entries
  ADD COLUMN IF NOT EXISTS principal_type text,
  ADD COLUMN IF NOT EXISTS principal_id text;
UPDATE workspace_memory_owned_entries oe
SET principal_type = p.principal_type, principal_id = p.principal_id
FROM workspace_memory_proposals p
WHERE p.id = oe.proposal_id AND (oe.principal_type IS NULL OR oe.principal_id IS NULL);
ALTER TABLE workspace_memory_owned_entries ALTER COLUMN principal_type SET NOT NULL;
ALTER TABLE workspace_memory_owned_entries ALTER COLUMN principal_id SET NOT NULL;
ALTER TABLE workspace_memory_owned_entries
  ADD CONSTRAINT workspace_memory_owned_entries_scope_identity_unique
  UNIQUE (entry_id, tenant_id, workspace_id, principal_type, principal_id);
ALTER TABLE workspace_memory_owned_entries
  ADD CONSTRAINT workspace_memory_owned_entries_proposal_identity_unique
  UNIQUE (entry_id, proposal_id, tenant_id, workspace_id, principal_type, principal_id);
ALTER TABLE workspace_memory_entries
  ADD CONSTRAINT workspace_memory_entries_exact_identity_unique
  UNIQUE (id, proposal_id, tenant_id, workspace_id, principal_type, principal_id);
ALTER TABLE workspace_memory_owned_entries
  ADD CONSTRAINT workspace_memory_owned_entries_canonical_entry_fk
  FOREIGN KEY (entry_id, proposal_id, tenant_id, workspace_id, principal_type, principal_id)
  REFERENCES workspace_memory_entries(id, proposal_id, tenant_id, workspace_id, principal_type, principal_id);
ALTER TABLE workspace_memory_snapshots
  ADD CONSTRAINT workspace_memory_snapshots_scope_identity_unique
  UNIQUE (snapshot_id, tenant_id, workspace_id);

CREATE TABLE IF NOT EXISTS workspace_memory_snapshot_entries (
  snapshot_id uuid NOT NULL, tenant_id text NOT NULL, workspace_id text NOT NULL,
  principal_type text NOT NULL, principal_id text NOT NULL,
  entry_id uuid NOT NULL, ordinal integer NOT NULL,
  PRIMARY KEY (snapshot_id, entry_id), UNIQUE (snapshot_id, ordinal),
  UNIQUE (snapshot_id, entry_id, tenant_id, workspace_id, principal_type, principal_id),
  FOREIGN KEY (snapshot_id, tenant_id, workspace_id) REFERENCES workspace_memory_snapshots(snapshot_id, tenant_id, workspace_id),
  FOREIGN KEY (entry_id, tenant_id, workspace_id, principal_type, principal_id) REFERENCES workspace_memory_owned_entries(entry_id, tenant_id, workspace_id, principal_type, principal_id),
  CHECK (ordinal >= 0)
);

CREATE TABLE IF NOT EXISTS workspace_memory_projection_receipts (
  proposal_id uuid PRIMARY KEY, entry_id uuid NOT NULL UNIQUE, snapshot_id uuid NOT NULL UNIQUE,
  tenant_id text NOT NULL, workspace_id text NOT NULL, principal_type text NOT NULL, principal_id text NOT NULL,
  state text NOT NULL, lease_owner text NULL, lease_expires_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0, safe_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (proposal_id) REFERENCES workspace_memory_proposals(id),
  FOREIGN KEY (proposal_id, tenant_id, workspace_id, principal_type, principal_id) REFERENCES workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id),
  FOREIGN KEY (entry_id, tenant_id, workspace_id, principal_type, principal_id) REFERENCES workspace_memory_owned_entries(entry_id, tenant_id, workspace_id, principal_type, principal_id),
  FOREIGN KEY (entry_id, proposal_id, tenant_id, workspace_id, principal_type, principal_id) REFERENCES workspace_memory_owned_entries(entry_id, proposal_id, tenant_id, workspace_id, principal_type, principal_id),
  FOREIGN KEY (snapshot_id, tenant_id, workspace_id) REFERENCES workspace_memory_snapshots(snapshot_id, tenant_id, workspace_id),
  FOREIGN KEY (snapshot_id, entry_id, tenant_id, workspace_id, principal_type, principal_id) REFERENCES workspace_memory_snapshot_entries(snapshot_id, entry_id, tenant_id, workspace_id, principal_type, principal_id),
  CHECK (state IN ('pending','publishing','ready','failed')),
  CHECK (attempt_count >= 0),
  CHECK ((state = 'publishing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'publishing' AND lease_owner IS NULL AND lease_expires_at IS NULL)),
  CHECK (safe_error_code IS NULL OR length(safe_error_code) <= 256)
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_memory_projection_incomplete_scope
  ON workspace_memory_projection_receipts(tenant_id, workspace_id) WHERE state <> 'ready';

COMMIT;
