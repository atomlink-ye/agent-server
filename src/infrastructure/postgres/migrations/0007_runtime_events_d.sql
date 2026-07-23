BEGIN;
CREATE TABLE IF NOT EXISTS runtime_session_bindings (
  run_id uuid PRIMARY KEY REFERENCES runs(id), provider_agent_id text NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS run_events (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id), sequence bigint NOT NULL CHECK(sequence > 0),
  type text NOT NULL CHECK(type IN ('started','output','succeeded','failed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL,
  UNIQUE(run_id, sequence), UNIQUE(run_id, type)
);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS cancellation_requested boolean NOT NULL DEFAULT false;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz NULL;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK(role IN ('user','assistant'));
CREATE INDEX IF NOT EXISTS run_events_run_sequence_idx ON run_events(run_id, sequence);
COMMIT;
