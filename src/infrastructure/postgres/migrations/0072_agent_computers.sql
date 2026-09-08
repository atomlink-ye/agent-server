BEGIN;

-- The Computer layer names where an Agent's execution namespace lives (cloud,
-- a paired local machine, or a VPS). It has no pairing protocol, credential,
-- or scheduling behavior yet -- just an identity a Agent definition can point
-- at, following the same tenant/workspace-scoped shape as agent_definitions.
CREATE TABLE IF NOT EXISTS computers (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cloud', 'local', 'vps')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT computers_updated_after_created_check CHECK (updated_at >= created_at)
);

-- Nullable and additive: an Agent definition with no computer row keeps
-- resolving to the shared default runtime namespace exactly as before.
ALTER TABLE agent_definitions
  ADD COLUMN IF NOT EXISTS computer_id uuid NULL REFERENCES computers(id);

COMMIT;
