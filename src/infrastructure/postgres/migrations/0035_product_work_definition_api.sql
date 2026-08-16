BEGIN;

-- Product author metadata is stored beside the immutable compiler source without
-- changing the execution source contract introduced by migration 0034.
ALTER TABLE work_definition_source_versions
  ADD COLUMN IF NOT EXISTS author_source jsonb NULL,
  ADD COLUMN IF NOT EXISTS author_fingerprint text NULL;

ALTER TABLE work_definition_source_versions
  DROP CONSTRAINT IF EXISTS work_definition_source_versions_author_fingerprint_check;
ALTER TABLE work_definition_source_versions
  ADD CONSTRAINT work_definition_source_versions_author_fingerprint_check CHECK (
    author_fingerprint IS NULL OR author_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS work_definition_source_versions_author_unique
  ON work_definition_source_versions(definition_id, author_fingerprint)
  WHERE author_fingerprint IS NOT NULL;

-- Resolved fingerprints are insert-only facts rather than mutable columns on an
-- immutable WorkDefinitionVersion.
CREATE TABLE IF NOT EXISTS work_definition_version_resolutions (
  version_id uuid PRIMARY KEY REFERENCES work_definition_source_versions(id),
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  resolved_fingerprint text NOT NULL CHECK(resolved_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);

-- Idempotency is a Product API concern. Reusing the same key with another
-- author fingerprint is rejected; successful replays return the exact version.
CREATE TABLE IF NOT EXISTS work_definition_apply_requests (
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  definition_id uuid NOT NULL REFERENCES work_definition_source_definitions(id),
  version_id uuid NOT NULL REFERENCES work_definition_source_versions(id),
  resolved_fingerprint text NOT NULL CHECK(resolved_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,workspace_id,principal_type,principal_id,idempotency_key)
);

-- Run input is a durable internal fact but is deliberately omitted from normal
-- Product WorkRun responses. Old WorkRuns remain valid with a NULL snapshot.
ALTER TABLE work_runs
  ADD COLUMN IF NOT EXISTS input_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS input_fingerprint text NULL;

ALTER TABLE work_runs
  DROP CONSTRAINT IF EXISTS work_runs_input_snapshot_object_check;
ALTER TABLE work_runs
  ADD CONSTRAINT work_runs_input_snapshot_object_check CHECK (
    input_snapshot IS NULL OR jsonb_typeof(input_snapshot) = 'object'
  );
ALTER TABLE work_runs
  DROP CONSTRAINT IF EXISTS work_runs_input_fingerprint_check;
ALTER TABLE work_runs
  ADD CONSTRAINT work_runs_input_fingerprint_check CHECK (
    input_fingerprint IS NULL OR input_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  );

COMMIT;
