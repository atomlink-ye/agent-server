BEGIN;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  root_task_id uuid NOT NULL,
  parent_task_id uuid NULL,
  parent_run_id uuid NULL,
  depth integer NOT NULL CHECK (depth >= 0),
  status text NOT NULL CHECK (status IN ('queued', 'active', 'completed', 'failed', 'cancelled')),
  ingress text NOT NULL CHECK (ingress IN ('api')),
  invokable_kind text NOT NULL CHECK (invokable_kind IN ('agent')),
  invokable_version_id text NOT NULL,
  input_snapshot_ref text NOT NULL,
  input_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT tasks_updated_after_created_check CHECK (updated_at >= created_at),
  CONSTRAINT tasks_root_shape_check CHECK (
    (
      depth = 0
      AND id = root_task_id
      AND parent_task_id IS NULL
      AND parent_run_id IS NULL
    ) OR (
      depth > 0
      AND id <> root_task_id
      AND parent_task_id IS NOT NULL
      AND parent_run_id IS NOT NULL
    )
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_root_task_fk'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_root_task_fk
      FOREIGN KEY (root_task_id)
      REFERENCES tasks(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_parent_task_fk'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_parent_task_fk
      FOREIGN KEY (parent_task_id)
      REFERENCES tasks(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timed_out')),
  lease_owner text NULL,
  activation_id uuid NULL,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_expires_at timestamptz NULL,
  runtime jsonb NULL,
  result jsonb NULL,
  usage jsonb NULL,
  error jsonb NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT runs_updated_after_created_check CHECK (updated_at >= created_at),
  CONSTRAINT runs_state_check CHECK (
    (
      status = 'queued'
      AND lease_owner IS NULL
      AND activation_id IS NULL
      AND lease_expires_at IS NULL
      AND result IS NULL
      AND error IS NULL
      AND fencing_token = 0
    ) OR (
      status = 'running'
      AND lease_owner IS NOT NULL
      AND activation_id IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND result IS NULL
      AND error IS NULL
      AND fencing_token > 0
    ) OR (
      status = 'succeeded'
      AND lease_owner IS NULL
      AND activation_id IS NULL
      AND lease_expires_at IS NULL
      AND result IS NOT NULL
      AND error IS NULL
      AND fencing_token > 0
    ) OR (
      status IN ('failed', 'timed_out')
      AND lease_owner IS NULL
      AND activation_id IS NULL
      AND lease_expires_at IS NULL
      AND result IS NULL
      AND error IS NOT NULL
      AND fencing_token > 0
    )
  ),
  UNIQUE (task_id, attempt)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_parent_run_fk'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_parent_run_fk
      FOREIGN KEY (parent_run_id)
      REFERENCES runs(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS admissions (
  id bigserial PRIMARY KEY,
  ingress text NOT NULL CHECK (ingress IN ('api')),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(id),
  created_at timestamptz NOT NULL,
  UNIQUE (task_id),
  UNIQUE (ingress, idempotency_key)
);

CREATE TABLE IF NOT EXISTS run_dispatches (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id),
  event_type text NOT NULL CHECK (event_type IN ('run.enqueue')),
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (run_id, event_type)
);

COMMIT;
