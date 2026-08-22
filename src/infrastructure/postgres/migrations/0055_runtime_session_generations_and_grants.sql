BEGIN;

CREATE TABLE IF NOT EXISTS runtime_tool_grants (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  product_session_id text NULL,
  scope_id text NOT NULL,
  team_member_run_id text NULL,
  team_run_id text NULL,
  allowed_tools jsonb NOT NULL,
  catalog_tools jsonb NOT NULL,
  active_turn jsonb NULL,
  chat_context jsonb NULL,
  expires_at timestamptz NOT NULL,
  renewable_until timestamptz NULL,
  revoked_at timestamptz NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS runtime_tool_grants_recoverable_idx
  ON runtime_tool_grants (expires_at, renewable_until)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS runtime_tool_grants_scope_idx
  ON runtime_tool_grants (
    tenant_id, workspace_id, principal_type, principal_id, scope_id
  )
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS runtime_tool_grants_team_run_idx
  ON runtime_tool_grants (team_run_id)
  WHERE revoked_at IS NULL AND team_run_id IS NOT NULL;

ALTER TABLE runtime_sessions
  ADD COLUMN IF NOT EXISTS desired_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS desired_spec_digest text NULL,
  ADD COLUMN IF NOT EXISTS runtime_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS current_generation_id uuid NULL;

ALTER TABLE runtime_sessions
  DROP CONSTRAINT IF EXISTS runtime_sessions_desired_revision_check,
  ADD CONSTRAINT runtime_sessions_desired_revision_check CHECK (desired_revision > 0),
  DROP CONSTRAINT IF EXISTS runtime_sessions_runtime_status_check,
  ADD CONSTRAINT runtime_sessions_runtime_status_check CHECK (
    runtime_status IN (
      'pending',
      'ready',
      'reconciling',
      'replacement_required',
      'unavailable',
      'closed'
    )
  );

CREATE TABLE IF NOT EXISTS runtime_session_generations (
  id uuid PRIMARY KEY,
  runtime_session_id uuid NOT NULL REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  plane text NOT NULL,
  external_workspace_id text NOT NULL,
  external_session_id text NOT NULL,
  applied_revision integer NOT NULL CHECK (applied_revision > 0),
  applied_spec_digest text NULL,
  endpoint_epoch text NOT NULL,
  extension_grant_id uuid NULL REFERENCES runtime_tool_grants(id),
  status text NOT NULL CHECK (status IN ('active','superseded','unavailable','closed')),
  created_at timestamptz NOT NULL,
  superseded_at timestamptz NULL,
  UNIQUE(runtime_session_id, generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS runtime_session_generations_one_active_uq
  ON runtime_session_generations (runtime_session_id)
  WHERE status = 'active';

-- Existing runtime bindings become generation 1. Their extension endpoint was
-- created by a process-local random listener, so the first post-migration
-- resolver pass is allowed to replace them when the desired endpoint/spec does
-- not match this legacy epoch.
INSERT INTO runtime_session_generations (
  id,
  runtime_session_id,
  generation,
  plane,
  external_workspace_id,
  external_session_id,
  applied_revision,
  applied_spec_digest,
  endpoint_epoch,
  extension_grant_id,
  status,
  created_at,
  superseded_at
)
SELECT
  rs.id,
  rs.id,
  1,
  'paseo',
  rs.paseo_workspace_id,
  rs.provider_agent_id,
  rs.desired_revision,
  rs.desired_spec_digest,
  'legacy-process-local-endpoint',
  NULL,
  'active',
  rs.created_at,
  NULL
FROM runtime_sessions rs
WHERE rs.paseo_workspace_id IS NOT NULL
  AND rs.provider_agent_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

UPDATE runtime_sessions rs
SET current_generation_id = rs.id,
    runtime_status = 'ready'
WHERE rs.current_generation_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM runtime_session_generations rsg
    WHERE rsg.id = rs.id
      AND rsg.runtime_session_id = rs.id
      AND rsg.status = 'active'
  );

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'runtime_sessions_current_generation_fk'
  ) THEN
    ALTER TABLE runtime_sessions
      ADD CONSTRAINT runtime_sessions_current_generation_fk
      FOREIGN KEY (current_generation_id)
      REFERENCES runtime_session_generations(id);
  END IF;
END $$;

COMMIT;
