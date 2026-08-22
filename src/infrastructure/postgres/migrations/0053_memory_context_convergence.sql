BEGIN;

CREATE TABLE IF NOT EXISTS memory_context_records (
  memory_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  scope_kind text NOT NULL CHECK (
    scope_kind IN ('organization','workspace','agent','agent_user','conversation','work')
  ),
  scope_key text NOT NULL,
  scope_json jsonb NOT NULL,
  logical_path text NOT NULL,
  source_kind text NOT NULL CHECK (
    source_kind IN (
      'memory_api','learning_proposal','conversation_promotion',
      'work_admission','work_result','manual_pin','legacy'
    )
  ),
  source_id text NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, scope_kind, scope_key, logical_path)
);
CREATE INDEX IF NOT EXISTS memory_context_records_scope_idx
  ON memory_context_records (tenant_id, scope_kind, scope_key, created_at, memory_id);

CREATE TABLE IF NOT EXISTS context_transitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  transition_kind text NOT NULL CHECK (
    transition_kind IN (
      'conversation_to_agent_user','conversation_to_work',
      'work_result_publish','memory_pin_to_agent'
    )
  ),
  source_scope_kind text NOT NULL,
  source_scope_key text NOT NULL,
  source_scope_json jsonb NOT NULL,
  source_path text NOT NULL,
  target_scope_kind text NOT NULL,
  target_scope_key text NOT NULL,
  target_scope_json jsonb NOT NULL,
  target_path text NOT NULL,
  source_sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (
    tenant_id,transition_kind,
    source_scope_kind,source_scope_key,source_path,
    target_scope_kind,target_scope_key,target_path,source_sha256
  )
);
CREATE INDEX IF NOT EXISTS context_transitions_target_idx
  ON context_transitions (tenant_id, target_scope_kind, target_scope_key, created_at);

COMMIT;
