BEGIN;

CREATE TABLE IF NOT EXISTS auth_users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username = lower(username)),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);

COMMIT;
