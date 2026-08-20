BEGIN;

CREATE TABLE IF NOT EXISTS conversation_work_entitlements (
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type = 'service_account'),
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id),
  FOREIGN KEY (conversation_id)
    REFERENCES conversations (id),
  FOREIGN KEY (workspace_id, tenant_id, principal_type, principal_id)
    REFERENCES workspaces (id, tenant_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS conversation_work_entitlements_principal_idx
  ON conversation_work_entitlements
    (tenant_id, workspace_id, principal_type, principal_id);

COMMIT;
