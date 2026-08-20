BEGIN;

-- The conversation table predates workspace ownership. Its tenant-qualified
-- identity is still sufficient to prevent a link from crossing tenants.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_id_tenant_uq
  ON conversations (id, tenant_id);

CREATE TABLE IF NOT EXISTS conversation_work_links (
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, work_id),
  FOREIGN KEY (work_id, tenant_id, workspace_id)
    REFERENCES works (id, tenant_id, workspace_id),
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations (id, tenant_id)
);

-- Keep the reverse lookup aligned with the scoped query used by the link API.
CREATE INDEX IF NOT EXISTS conversation_work_links_work_scope_idx
  ON conversation_work_links (work_id, tenant_id, workspace_id);

COMMIT;
