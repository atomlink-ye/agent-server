BEGIN;

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('direct','group')),
  title text NULL,
  topic text NULL,
  direct_pair_key text NULL,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_pair_key_uq
  ON conversations(tenant_id, direct_pair_key) WHERE direct_pair_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  tenant_id text NOT NULL,
  member_type text NOT NULL CHECK (member_type IN ('principal','agent_definition')),
  member_id text NOT NULL,
  member_principal_type text NULL,
  role text NULL,
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, member_type, member_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_member_idx
  ON conversation_members(tenant_id, member_type, member_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sequence bigint NOT NULL,
  author_type text NOT NULL CHECK (author_type IN ('principal','agent_definition')),
  author_id text NOT NULL,
  body text NOT NULL,
  agent_definition_id text NULL,
  agent_version_id text NULL,
  runtime_epoch integer NULL,
  work_ref text NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (conversation_id, sequence)
);

CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  last_read_sequence bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS agent_chat_runtimes (
  tenant_id text NOT NULL,
  agent_definition_id text NOT NULL,
  active_agent_version_id text NOT NULL,
  epoch integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','draining','unavailable')),
  last_active_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, agent_definition_id)
);

COMMIT;
