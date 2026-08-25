BEGIN;

-- Formal Work execution has its own versioned identity. Existing managed Agent
-- packages are copied with stable UUIDs so persisted Work/Team references can
-- be cut over without rewriting historical execution identity.
CREATE TABLE IF NOT EXISTS worker_definitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  description text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT worker_definitions_updated_after_created_check
    CHECK (updated_at >= created_at),
  UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_definitions_owner_name_uq
  ON worker_definitions (tenant_id, principal_type, principal_id, normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS worker_definitions_owner_identity_uq
  ON worker_definitions (id, tenant_id, principal_type, principal_id);

CREATE TABLE IF NOT EXISTS worker_versions (
  id uuid PRIMARY KEY,
  definition_id uuid NOT NULL REFERENCES worker_definitions(id),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  name text NOT NULL,
  description text NULL,
  instructions text NOT NULL,
  canonical_package jsonb NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  compiler_metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz NULL,
  CONSTRAINT worker_versions_updated_after_created_check
    CHECK (updated_at >= created_at),
  CONSTRAINT worker_versions_published_shape_check CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (
      status = 'published'
      AND published_at IS NOT NULL
      AND updated_at >= published_at
      AND published_at >= created_at
    )
  ),
  UNIQUE (id, definition_id, tenant_id, principal_type, principal_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_versions_definition_fingerprint_uq
  ON worker_versions (definition_id, fingerprint);
CREATE INDEX IF NOT EXISTS worker_versions_owner_idx
  ON worker_versions (tenant_id, principal_type, principal_id, updated_at DESC, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'worker_versions_definition_scope_fk'
  ) THEN
    ALTER TABLE worker_versions
      ADD CONSTRAINT worker_versions_definition_scope_fk
      FOREIGN KEY (
        definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      )
      REFERENCES worker_definitions(
        id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS worker_registry_idempotency (
  operation text NOT NULL CHECK (operation IN ('import', 'publish')),
  tenant_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 255),
  request_fingerprint text NOT NULL CHECK (length(btrim(request_fingerprint)) BETWEEN 1 AND 512),
  definition_id uuid NULL,
  version_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (operation, tenant_id, principal_type, principal_id, idempotency_key),
  CHECK (((version_id IS NULL) = (definition_id IS NULL)) IS TRUE),
  FOREIGN KEY (definition_id, tenant_id, principal_type, principal_id)
    REFERENCES worker_definitions(id, tenant_id, principal_type, principal_id),
  FOREIGN KEY (version_id, definition_id, tenant_id, principal_type, principal_id)
    REFERENCES worker_versions(id, definition_id, tenant_id, principal_type, principal_id)
);

CREATE OR REPLACE FUNCTION prevent_worker_definition_mutation()
RETURNS trigger AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Worker definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS worker_definitions_immutable_before_update
  ON worker_definitions;
CREATE TRIGGER worker_definitions_immutable_before_update
  BEFORE UPDATE ON worker_definitions FOR EACH ROW
  EXECUTE FUNCTION prevent_worker_definition_mutation();

CREATE OR REPLACE FUNCTION prevent_worker_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'published'
     AND NEW.id = OLD.id
     AND NEW.definition_id = OLD.definition_id
     AND NEW.tenant_id = OLD.tenant_id
     AND NEW.workspace_id = OLD.workspace_id
     AND NEW.principal_type = OLD.principal_type
     AND NEW.principal_id = OLD.principal_id
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.instructions IS NOT DISTINCT FROM OLD.instructions
     AND NEW.canonical_package IS NOT DISTINCT FROM OLD.canonical_package
     AND NEW.fingerprint IS NOT DISTINCT FROM OLD.fingerprint
     AND NEW.compiler_metadata IS NOT DISTINCT FROM OLD.compiler_metadata
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Worker versions are immutable except draft to published';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS worker_versions_immutable_before_update
  ON worker_versions;
CREATE TRIGGER worker_versions_immutable_before_update
  BEFORE UPDATE ON worker_versions FOR EACH ROW
  EXECUTE FUNCTION prevent_worker_version_mutation();

-- Bootstrap the Worker registry from executable managed Agent packages. This is
-- a one-time namespace split: the copied Worker resource is independent and its
-- publication has no Chat lifecycle side effect.
INSERT INTO worker_definitions (
  id, tenant_id, workspace_id, principal_type, principal_id,
  name, normalized_name, description, created_at, updated_at
)
SELECT
  id, tenant_id, workspace_id, principal_type, principal_id,
  name, normalized_name, summary, created_at, updated_at
FROM agent_definitions
WHERE managed_discriminator = 'managed_agent_v1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO worker_versions (
  id, definition_id, tenant_id, workspace_id, principal_type, principal_id,
  status, name, description, instructions, canonical_package, fingerprint,
  compiler_metadata, created_at, updated_at, published_at
)
SELECT
  id, definition_id, tenant_id, workspace_id, principal_type, principal_id,
  status, name, description, instructions,
  jsonb_set(canonical_package, '{kind}', '"Worker"'::jsonb, true),
  fingerprint, compiler_metadata, created_at, updated_at, published_at
FROM agent_versions
WHERE managed_discriminator = 'managed_agent_v1'
ON CONFLICT (id) DO NOTHING;

-- Canonical Work author/source vocabulary becomes Worker-based. Published
-- source rows are immutable at runtime, so the migration temporarily removes
-- the immutability trigger while performing this one schema-version cutover.
DROP TRIGGER IF EXISTS work_definition_source_versions_immutable_trg
  ON work_definition_source_versions;

UPDATE work_definition_source_versions
SET source = CASE
  WHEN source ->> 'kind' = 'single_agent' THEN
    (source - 'agentVersionId' - 'kind')
      || jsonb_build_object(
           'kind', 'single_worker',
           'workerVersionId', source ->> 'agentVersionId'
         )
  ELSE source
END,
author_source = CASE
  WHEN author_source -> 'spec' ->> 'kind' = 'single_agent' THEN
    jsonb_set(
      jsonb_set(
        (author_source #- '{spec,agent_version_id}') #- '{spec,agent}',
        '{spec,kind}',
        '"single_worker"'::jsonb,
        true
      ),
      '{spec,worker_version_id}',
      to_jsonb(
        COALESCE(
          author_source -> 'spec' ->> 'agent_version_id',
          source ->> 'agentVersionId'
        )
      ),
      true
    )
  ELSE author_source
END;

CREATE TRIGGER work_definition_source_versions_immutable_trg
  BEFORE UPDATE OR DELETE ON work_definition_source_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_work_definition_source_version_mutation();

-- Formal Team definitions are execution composition and therefore point to
-- Worker versions. Preserve the human-readable role/name shape.
UPDATE team_versions
SET spec = jsonb_build_object(
  'lead', jsonb_build_object(
    'name', spec #>> '{lead,name}',
    'workerVersionId', spec #>> '{lead,agentVersionId}'
  ),
  'roster', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', member ->> 'name',
          'workerVersionId', member ->> 'agentVersionId'
        )
        ORDER BY ordinality
      )
      FROM jsonb_array_elements(COALESCE(spec -> 'roster', '[]'::jsonb))
           WITH ORDINALITY AS members(member, ordinality)
    ),
    '[]'::jsonb
  ),
  'environmentVersionId', spec ->> 'environmentVersionId'
)
WHERE spec ? 'lead' AND (spec -> 'lead') ? 'agentVersionId';

ALTER TABLE team_versions
  DROP CONSTRAINT IF EXISTS team_versions_spec_shape_check;
ALTER TABLE team_versions
  ADD CONSTRAINT team_versions_spec_shape_check CHECK (
    jsonb_typeof(spec) = 'object'
    AND jsonb_typeof(spec -> 'lead') = 'object'
    AND jsonb_typeof(spec -> 'roster') = 'array'
    AND jsonb_array_length(spec -> 'roster') BETWEEN 1 AND 16
    AND nullif(btrim(spec #>> '{lead,name}'), '') IS NOT NULL
    AND nullif(btrim(spec #>> '{lead,workerVersionId}'), '') IS NOT NULL
    AND nullif(btrim(spec ->> 'environmentVersionId'), '') IS NOT NULL
  );

ALTER TABLE team_member_runs
  ADD COLUMN IF NOT EXISTS worker_version_id uuid NULL;
UPDATE team_member_runs
SET worker_version_id = agent_version_id
WHERE worker_version_id IS NULL;
ALTER TABLE team_member_runs
  ALTER COLUMN worker_version_id SET NOT NULL;
ALTER TABLE team_member_runs
  ALTER COLUMN agent_version_id DROP NOT NULL;

ALTER TABLE work_run_resource_manifest
  DROP CONSTRAINT IF EXISTS work_run_resource_manifest_resource_kind_check;
ALTER TABLE work_run_resource_manifest
  ADD CONSTRAINT work_run_resource_manifest_resource_kind_check CHECK (
    resource_kind IN (
      'definition',
      'agent',
      'worker',
      'environment',
      'memory',
      'skill',
      'tool',
      'platform_capability'
    )
  );

COMMIT;
