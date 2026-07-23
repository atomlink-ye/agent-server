BEGIN;

ALTER TABLE agent_definitions
  ADD COLUMN IF NOT EXISTS managed_discriminator text NULL,
  ADD COLUMN IF NOT EXISTS normalized_name text NULL;

ALTER TABLE agent_definitions
  ADD CONSTRAINT agent_definitions_managed_shape_check CHECK ((
    (managed_discriminator IS NULL AND normalized_name IS NULL)
    OR (managed_discriminator = 'managed_agent_v1' AND normalized_name IS NOT NULL AND length(btrim(normalized_name)) > 0)
  ) IS TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_managed_owner_name_uq
  ON agent_definitions (tenant_id, principal_type, principal_id, normalized_name)
  WHERE managed_discriminator = 'managed_agent_v1';

CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_id_discriminator_uq
  ON agent_definitions (id, managed_discriminator);

CREATE INDEX IF NOT EXISTS agent_definitions_managed_owner_hidden_idx
  ON agent_definitions (tenant_id, principal_type, principal_id, updated_at DESC, id)
  WHERE managed_discriminator = 'managed_agent_v1';

ALTER TABLE agent_versions
  ADD COLUMN IF NOT EXISTS managed_discriminator text NULL,
  ADD COLUMN IF NOT EXISTS canonical_package jsonb NULL,
  ADD COLUMN IF NOT EXISTS fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS pattern_metadata jsonb NULL,
  ADD COLUMN IF NOT EXISTS compiler_metadata jsonb NULL,
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS reference_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS tool_skill_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS validation_report jsonb NULL,
  ADD COLUMN IF NOT EXISTS compiled_package jsonb NULL,
  ADD COLUMN IF NOT EXISTS execution_snapshot jsonb NULL;

ALTER TABLE agent_versions
  ADD CONSTRAINT agent_versions_managed_shape_check CHECK ((
    (managed_discriminator IS NULL AND canonical_package IS NULL AND fingerprint IS NULL AND pattern_metadata IS NULL
      AND compiler_metadata IS NULL AND policy_snapshot IS NULL AND reference_snapshot IS NULL
      AND tool_skill_snapshot IS NULL AND validation_report IS NULL AND compiled_package IS NULL AND execution_snapshot IS NULL)
    OR (managed_discriminator = 'managed_agent_v1' AND canonical_package IS NOT NULL AND fingerprint IS NOT NULL
      AND fingerprint ~ '^[0-9a-f]{64}$' AND pattern_metadata IS NOT NULL AND compiler_metadata IS NOT NULL
      AND policy_snapshot IS NOT NULL AND reference_snapshot IS NOT NULL AND tool_skill_snapshot IS NOT NULL
      AND validation_report IS NOT NULL AND compiled_package IS NOT NULL AND execution_snapshot IS NOT NULL)
  ) IS TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_managed_definition_fingerprint_uq
  ON agent_versions (definition_id, fingerprint)
  WHERE managed_discriminator = 'managed_agent_v1';

CREATE INDEX IF NOT EXISTS agent_versions_managed_owner_hidden_idx
  ON agent_versions (tenant_id, principal_type, principal_id, updated_at DESC, id)
  WHERE managed_discriminator = 'managed_agent_v1';

CREATE INDEX IF NOT EXISTS agent_versions_definition_created_cursor_idx
  ON agent_versions (definition_id, created_at ASC, id ASC);

ALTER TABLE agent_versions
  ADD CONSTRAINT agent_versions_managed_definition_fk
  FOREIGN KEY (definition_id, managed_discriminator)
  REFERENCES agent_definitions (id, managed_discriminator);

CREATE TABLE IF NOT EXISTS agent_registry_idempotency (
  operation text NOT NULL,
  tenant_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  definition_id uuid NULL REFERENCES agent_definitions(id),
  version_id uuid NULL REFERENCES agent_versions(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (operation, tenant_id, principal_type, principal_id, idempotency_key),
  CONSTRAINT agent_registry_idempotency_operation_check CHECK (operation IN ('import', 'publish')),
  CONSTRAINT agent_registry_idempotency_key_check CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 255),
  CONSTRAINT agent_registry_idempotency_fingerprint_check CHECK (length(btrim(request_fingerprint)) BETWEEN 1 AND 512),
  CONSTRAINT agent_registry_idempotency_owner_check CHECK (length(btrim(tenant_id)) > 0 AND length(btrim(principal_type)) > 0 AND length(btrim(principal_id)) > 0),
  CONSTRAINT agent_registry_idempotency_timestamp_check CHECK (updated_at >= created_at),
  CONSTRAINT agent_registry_idempotency_result_check CHECK (version_id IS NULL OR definition_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION prevent_managed_agent_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.managed_discriminator IS NULL AND NEW.managed_discriminator IS NOT NULL THEN
    RAISE EXCEPTION 'Managed agent versions may only be created by INSERT';
  END IF;
  IF OLD.managed_discriminator IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'published'
     AND NEW.id = OLD.id AND NEW.definition_id = OLD.definition_id AND NEW.tenant_id = OLD.tenant_id AND NEW.workspace_id = OLD.workspace_id
     AND NEW.principal_type = OLD.principal_type AND NEW.principal_id = OLD.principal_id
     AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.instructions IS NOT DISTINCT FROM OLD.instructions AND NEW.managed_discriminator IS NOT DISTINCT FROM OLD.managed_discriminator
     AND NEW.canonical_package IS NOT DISTINCT FROM OLD.canonical_package AND NEW.fingerprint IS NOT DISTINCT FROM OLD.fingerprint
     AND NEW.pattern_metadata IS NOT DISTINCT FROM OLD.pattern_metadata AND NEW.compiler_metadata IS NOT DISTINCT FROM OLD.compiler_metadata
     AND NEW.policy_snapshot IS NOT DISTINCT FROM OLD.policy_snapshot AND NEW.reference_snapshot IS NOT DISTINCT FROM OLD.reference_snapshot
     AND NEW.tool_skill_snapshot IS NOT DISTINCT FROM OLD.tool_skill_snapshot AND NEW.validation_report IS NOT DISTINCT FROM OLD.validation_report
     AND NEW.compiled_package IS NOT DISTINCT FROM OLD.compiled_package AND NEW.execution_snapshot IS NOT DISTINCT FROM OLD.execution_snapshot
     AND NEW.created_at = OLD.created_at THEN RETURN NEW;
  END IF;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Managed agent versions are immutable except draft to published';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_versions_managed_immutable_before_update ON agent_versions;
CREATE TRIGGER agent_versions_managed_immutable_before_update
  BEFORE UPDATE ON agent_versions FOR EACH ROW EXECUTE FUNCTION prevent_managed_agent_version_mutation();

COMMIT;
