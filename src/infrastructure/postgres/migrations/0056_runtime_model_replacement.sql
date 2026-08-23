BEGIN;

-- DECISION-006 / PLAN-V2 §§14-15: reset runtime execution state at the schema
-- boundary. RuntimeSession, launch-snapshot, generation, and grant rows are
-- external-provider live-binding state, not durable product facts. They are
-- intentionally discarded so the replacement model starts without legacy
-- provider bindings, endpoint epochs, or grant shapes. The legacy Work
-- run_id provenance in runtime_session_bindings is preserved in Phase 1.
--
-- This reset is deliberately limited to the runtime authorities being
-- replaced: runtime_sessions bindings, runtime_session_generations' legacy
-- binding shape, and session_launch_snapshots. The legacy Work run_id
-- provenance in runtime_session_bindings is explicitly preserved in Phase 1;
-- it is not a reset authority. Deleting it belongs to the Work/Team cutover,
-- not to a Chat fallback. Work, Run, Task, Agent, Team, Memory, and Chat
-- durable tables are not deleted, altered, backfilled, or used as
-- compatibility storage. There is no dual schema, compatibility view, or
-- data backfill.

-- Remove the old dependency graph without CASCADE so no durable table can be
-- changed implicitly. The old current-generation FK points at the generation
-- table and must be removed before that table is dropped.
ALTER TABLE runtime_sessions
  DROP CONSTRAINT IF EXISTS runtime_sessions_current_generation_fk;

-- 0055 made the legacy generation row point at its one extension grant. Drop
-- that obsolete edge before removing the grant table; the replacement grant
-- table is linked to generations and turns in the opposite direction.
ALTER TABLE runtime_session_generations
  DROP CONSTRAINT IF EXISTS runtime_session_generations_extension_grant_id_fkey;

DROP TABLE IF EXISTS runtime_tool_grants;
DROP TABLE IF EXISTS runtime_turns;
DROP TABLE IF EXISTS runtime_session_generations;
DROP TABLE IF EXISTS runtime_sessions;
DROP TABLE IF EXISTS session_launch_snapshots;
DROP FUNCTION IF EXISTS prevent_session_launch_snapshot_mutation();

-- RuntimeSession owns stable identity and normalized scope only. Provider
-- bindings, launch snapshots, and desired-spec payloads live in the tables
-- below rather than on this identity row.
CREATE TABLE runtime_sessions (
  id uuid PRIMARY KEY,

  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,

  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  scope_epoch integer NULL,

  desired_spec_revision integer NOT NULL,
  current_generation_id uuid NULL,

  status text NOT NULL CHECK (
    status IN (
      'provisioning',
      'ready',
      'reconciling',
      'degraded',
      'closed'
    )
  ),

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz NULL
);

CREATE UNIQUE INDEX runtime_sessions_scope_uq
  ON runtime_sessions (
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    scope_kind,
    scope_id,
    COALESCE(scope_epoch, 0)
  );

CREATE TABLE runtime_session_specs (
  runtime_session_id uuid NOT NULL
    REFERENCES runtime_sessions(id) ON DELETE CASCADE,

  revision integer NOT NULL CHECK (revision > 0),

  workspace_id text NOT NULL,
  agent_version_id uuid NOT NULL,
  environment_version_id uuid NULL,

  resolved_skills jsonb NOT NULL,
  tool_refs jsonb NOT NULL,

  provider text NOT NULL,
  model text NULL,
  cwd text NOT NULL,

  system_prompt_digest text NOT NULL,
  skill_set_digest text NOT NULL,
  tool_catalog_digest text NOT NULL,
  extension_set_digest text NOT NULL,
  context_epoch bigint NOT NULL,

  bootstrap_digest text NOT NULL,

  created_at timestamptz NOT NULL,

  PRIMARY KEY (runtime_session_id, revision)
);

CREATE OR REPLACE FUNCTION prevent_runtime_session_spec_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Runtime session specs are immutable';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS runtime_session_specs_immutable_before_update
  ON runtime_session_specs;
CREATE TRIGGER runtime_session_specs_immutable_before_update
  BEFORE UPDATE ON runtime_session_specs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_runtime_session_spec_mutation();

CREATE TABLE runtime_session_generations (
  id uuid PRIMARY KEY,

  runtime_session_id uuid NOT NULL
    REFERENCES runtime_sessions(id) ON DELETE CASCADE,

  generation integer NOT NULL CHECK (generation > 0),

  provider text NOT NULL,
  provider_workspace_id text NULL,
  provider_session_id text NULL,

  applied_spec_revision integer NOT NULL,
  applied_bootstrap_digest text NOT NULL,

  endpoint_epoch text NOT NULL,

  status text NOT NULL CHECK (
    status IN (
      'provisioning',
      'active',
      'superseded',
      'failed',
      'closed'
    )
  ),

  created_at timestamptz NOT NULL,
  ready_at timestamptz NULL,
  superseded_at timestamptz NULL,
  closed_at timestamptz NULL,

  CHECK (
    status <> 'active' OR (
      provider_session_id IS NOT NULL
      AND provider_workspace_id IS NOT NULL
    )
  ),

  UNIQUE (runtime_session_id, generation),
  UNIQUE (id, runtime_session_id)
);

CREATE TABLE runtime_turns (
  id uuid PRIMARY KEY,

  runtime_session_id uuid NOT NULL
    REFERENCES runtime_sessions(id) ON DELETE CASCADE,

  generation_id uuid NULL,

  source_kind text NOT NULL,
  source_id text NOT NULL,
  source_context jsonb NOT NULL,

  status text NOT NULL CHECK (
    status IN (
      'pending',
      'preparing',
      'running',
      'succeeded',
      'failed',
      'cancelled'
    )
  ),

  prompt_digest text NULL,
  failure_code text NULL,

  created_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,

  UNIQUE (id, runtime_session_id, generation_id),
  FOREIGN KEY (generation_id, runtime_session_id)
    REFERENCES runtime_session_generations(id, runtime_session_id)
);

CREATE INDEX runtime_turns_session_created_idx
  ON runtime_turns (runtime_session_id, created_at DESC);

CREATE TABLE runtime_tool_grants (
  id uuid PRIMARY KEY,

  runtime_session_id uuid NOT NULL
    REFERENCES runtime_sessions(id) ON DELETE CASCADE,

  generation_id uuid NOT NULL,

  runtime_turn_id uuid NULL,

  token_hash text NOT NULL UNIQUE,

  catalog_digest text NOT NULL,
  allowed_tools jsonb NOT NULL,

  revision integer NOT NULL CHECK (revision > 0),

  expires_at timestamptz NOT NULL,
  renewable_until timestamptz NULL,
  revoked_at timestamptz NULL,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CHECK (
    jsonb_typeof(allowed_tools) = 'array'
    AND NOT jsonb_path_exists(
      allowed_tools,
      '$[*] ? (@.type() != "string")'
    )
  ),
  CHECK (length(btrim(catalog_digest)) > 0),
  CHECK (renewable_until IS NULL OR renewable_until >= expires_at),

  FOREIGN KEY (generation_id, runtime_session_id)
    REFERENCES runtime_session_generations(id, runtime_session_id),
  FOREIGN KEY (runtime_turn_id, runtime_session_id, generation_id)
    REFERENCES runtime_turns(id, runtime_session_id, generation_id)
);

-- Add the convenience projection only after its target table exists. This
-- ordering avoids the circular-reference failure present in the old shape.
ALTER TABLE runtime_sessions
  ADD CONSTRAINT runtime_sessions_current_generation_fk
  FOREIGN KEY (current_generation_id)
  REFERENCES runtime_session_generations(id);

COMMIT;
