BEGIN;

CREATE TABLE IF NOT EXISTS agent_home_entries (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_definition_id text NOT NULL,
  namespace text NOT NULL CHECK (namespace IN ('organization','space','agent-shared','user','conversation','work','scratch')),
  scope_key text NOT NULL,
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 512),
  current_version integer NOT NULL CHECK (current_version > 0),
  content text NOT NULL CHECK (length(content) > 0),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_size_bytes integer NOT NULL CHECK (content_size_bytes > 0 AND content_size_bytes <= 65536),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, agent_definition_id, namespace, scope_key, path)
);
CREATE INDEX IF NOT EXISTS agent_home_entries_scope_idx
  ON agent_home_entries(tenant_id, agent_definition_id, namespace, scope_key);

CREATE TABLE IF NOT EXISTS agent_home_snapshots (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES agent_home_entries(id),
  version integer NOT NULL CHECK (version > 0),
  content text NOT NULL,
  content_sha256 text NOT NULL,
  content_size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (entry_id, version)
);

COMMIT;
