BEGIN;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, principal_type text NOT NULL,
  principal_id text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, UNIQUE (id, tenant_id, principal_type, principal_id)
);
CREATE TABLE IF NOT EXISTS product_sessions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  tenant_id text NOT NULL, principal_type text NOT NULL, principal_id text NOT NULL,
  published_agent_version_id text NOT NULL, generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resetting')), created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS session_lanes (
  session_id uuid PRIMARY KEY REFERENCES product_sessions(id), generation integer NOT NULL,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0), active_task_id uuid NULL,
  active_cancellation_requested boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES product_sessions(id), generation integer NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0), role text NOT NULL CHECK (role IN ('user')),
  text text NOT NULL, task_id uuid NOT NULL REFERENCES tasks(id), created_at timestamptz NOT NULL,
  UNIQUE (session_id, generation, sequence)
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_id uuid NULL REFERENCES product_sessions(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS generation integer NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lane_sequence bigint NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS failure_detail text NULL;
CREATE INDEX IF NOT EXISTS tasks_session_lane_order_idx ON tasks(session_id, generation, lane_sequence);
CREATE INDEX IF NOT EXISTS messages_session_order_idx ON messages(session_id, generation, sequence);

COMMIT;
