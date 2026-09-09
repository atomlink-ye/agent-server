BEGIN;

ALTER TABLE work_runs
  ADD CONSTRAINT work_runs_owner_work_unique
  UNIQUE (id, tenant_id, workspace_id, work_id);

CREATE TABLE work_preparations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('collecting','ready','starting','started','abandoned')),
  definition_version_id uuid NOT NULL,
  schema_fingerprint text NOT NULL,
  candidate_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_fingerprint text NULL,
  start_intent text NULL,
  work_run_id uuid NULL,
  source_message_id uuid NULL,
  missing text[] NOT NULL DEFAULT '{}',
  ambiguities text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (work_id, tenant_id, workspace_id) REFERENCES works(id, tenant_id, workspace_id),
  FOREIGN KEY (work_run_id, tenant_id, workspace_id, work_id) REFERENCES work_runs(id, tenant_id, workspace_id, work_id),
  UNIQUE (tenant_id, workspace_id, work_id, revision),
  UNIQUE (tenant_id, workspace_id, work_id, start_intent),
  UNIQUE (id, tenant_id, workspace_id, work_id),
  CHECK (status <> 'started' OR (work_run_id IS NOT NULL AND start_intent IS NOT NULL AND confirmed_fingerprint IS NOT NULL)),
  CHECK (status <> 'starting' OR (start_intent IS NOT NULL AND confirmed_fingerprint IS NOT NULL))
);

CREATE UNIQUE INDEX work_preparations_one_active_per_work
  ON work_preparations (tenant_id, workspace_id, work_id)
  WHERE status IN ('collecting','ready','starting');
CREATE UNIQUE INDEX work_preparations_one_run
  ON work_preparations (work_run_id)
  WHERE work_run_id IS NOT NULL;
CREATE INDEX work_preparations_lookup_idx
  ON work_preparations (tenant_id, workspace_id, work_id, revision DESC);
CREATE UNIQUE INDEX work_preparations_source_message_unique
  ON work_preparations (tenant_id, workspace_id, work_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

ALTER TABLE work_chat_messages
  ADD COLUMN preparation_id uuid NULL,
  ADD COLUMN work_run_id uuid NULL;
ALTER TABLE work_chat_messages
  ADD CONSTRAINT work_chat_messages_preparation_fk
    FOREIGN KEY (preparation_id, tenant_id, workspace_id, work_id)
    REFERENCES work_preparations(id, tenant_id, workspace_id, work_id);
ALTER TABLE work_chat_messages
  ADD CONSTRAINT work_chat_messages_work_run_fk
    FOREIGN KEY (work_run_id, tenant_id, workspace_id, work_id)
    REFERENCES work_runs(id, tenant_id, workspace_id, work_id);
CREATE INDEX work_chat_messages_preparation_idx
  ON work_chat_messages (work_id, preparation_id, sequence);

COMMIT;
