BEGIN;

CREATE TABLE IF NOT EXISTS lark_memory_review_surfaces (
  id text PRIMARY KEY CHECK (octet_length(id) BETWEEN 1 AND 512),
  tenant_id text NOT NULL CHECK (octet_length(tenant_id) BETWEEN 1 AND 512),
  workspace_id text NOT NULL CHECK (octet_length(workspace_id) BETWEEN 1 AND 512),
  principal_type text NOT NULL CHECK (octet_length(principal_type) BETWEEN 1 AND 256),
  principal_id text NOT NULL CHECK (octet_length(principal_id) BETWEEN 1 AND 512),
  proposal_id uuid NOT NULL,
  binding_id text NOT NULL CHECK (octet_length(binding_id) BETWEEN 1 AND 512) REFERENCES channel_conversation_bindings(id),
  version integer NOT NULL CHECK (version >= 1),
  mode text NOT NULL CHECK (mode IN ('card', 'card_with_doc', 'command_only')),
  status text NOT NULL CHECK (status IN ('planned', 'publishing', 'active_card', 'active_card_with_doc', 'command_only', 'processing', 'resolved', 'stale', 'delivery_unknown')),
  card_message_id text CHECK (card_message_id IS NULL OR octet_length(card_message_id) BETWEEN 1 AND 512),
  doc_token text CHECK (doc_token IS NULL OR octet_length(doc_token) BETWEEN 1 AND 512),
  doc_revision text CHECK (doc_revision IS NULL OR octet_length(doc_revision) BETWEEN 1 AND 512),
  preview_content text CHECK (preview_content IS NULL OR octet_length(preview_content) BETWEEN 1 AND 4096),
  preview_sha256 text CHECK (preview_sha256 IS NULL OR preview_sha256 ~ '^[0-9a-f]{64}$'),
  action_token_hash text CHECK (action_token_hash IS NULL OR action_token_hash ~ '^[0-9a-f]{64}$'),
  creating_ingress_id text NOT NULL CHECK (octet_length(creating_ingress_id) BETWEEN 1 AND 512) REFERENCES channel_ingress_events(id),
  resolving_ingress_id text CHECK (resolving_ingress_id IS NULL OR octet_length(resolving_ingress_id) BETWEEN 1 AND 512) REFERENCES channel_ingress_events(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT lark_memory_review_surfaces_proposal_owner_fk
    FOREIGN KEY (proposal_id, tenant_id, workspace_id, principal_type, principal_id)
    REFERENCES workspace_memory_proposals (id, tenant_id, workspace_id, principal_type, principal_id),
  CONSTRAINT lark_memory_review_surfaces_preview_pair
    CHECK ((preview_content IS NULL) = (preview_sha256 IS NULL)),
  CONSTRAINT lark_memory_review_surfaces_status_mode
    CHECK ((mode = 'card' AND status IN ('planned', 'publishing', 'active_card', 'processing', 'resolved', 'stale', 'delivery_unknown'))
      OR (mode = 'card_with_doc' AND status IN ('planned', 'publishing', 'active_card_with_doc', 'processing', 'resolved', 'stale', 'delivery_unknown'))
      OR (mode = 'command_only' AND status IN ('planned', 'publishing', 'command_only', 'processing', 'resolved', 'stale', 'delivery_unknown'))),
  UNIQUE (tenant_id, workspace_id, proposal_id, binding_id, version),
  UNIQUE (tenant_id, workspace_id, binding_id, action_token_hash),
  UNIQUE (tenant_id, workspace_id, proposal_id, binding_id, creating_ingress_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS lark_memory_review_surfaces_one_active
  ON lark_memory_review_surfaces (tenant_id, workspace_id, proposal_id, binding_id)
  WHERE status IN ('planned', 'publishing', 'active_card', 'active_card_with_doc', 'command_only', 'processing');

CREATE INDEX IF NOT EXISTS lark_memory_review_surfaces_action_lookup
  ON lark_memory_review_surfaces (tenant_id, workspace_id, action_token_hash)
  WHERE action_token_hash IS NOT NULL;

COMMIT;
