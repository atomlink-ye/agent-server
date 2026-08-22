BEGIN;

-- Canonical product-world file storage. Ownership is expressed by scope_kind
-- + scope_key and is intentionally independent of the Agent currently viewing
-- the data. This is what makes a Work filesystem shared by multiple Agents.
CREATE TABLE IF NOT EXISTS context_entries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  scope_kind text NOT NULL CHECK (
    scope_kind IN (
      'organization',
      'workspace',
      'agent',
      'agent_home',
      'agent_user',
      'conversation',
      'work',
      'runtime_scratch'
    )
  ),
  scope_key text NOT NULL,
  path text NOT NULL,
  current_version integer NOT NULL CHECK (current_version > 0),
  content text NOT NULL,
  content_sha256 text NOT NULL,
  content_size_bytes integer NOT NULL CHECK (content_size_bytes > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, scope_kind, scope_key, path)
);

CREATE INDEX IF NOT EXISTS context_entries_scope_idx
  ON context_entries (tenant_id, scope_kind, scope_key, path);

CREATE TABLE IF NOT EXISTS context_entry_snapshots (
  id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES context_entries(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content text NOT NULL,
  content_sha256 text NOT NULL,
  content_size_bytes integer NOT NULL CHECK (content_size_bytes > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (entry_id, version)
);

COMMIT;
