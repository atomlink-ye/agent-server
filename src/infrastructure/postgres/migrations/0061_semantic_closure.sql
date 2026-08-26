BEGIN;

-- Semantic closure for the Coworker / Worker split.
-- This migration is additive relative to 0058-0060 and repairs already-applied
-- environments rather than rewriting historical migration files.

-- ---------------------------------------------------------------------------
-- 1. Worker owner identity: tenant + workspace + principal.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS worker_definitions_owner_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS worker_definitions_owner_name_uq
  ON worker_definitions (
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    normalized_name
  );

ALTER TABLE worker_registry_idempotency
  ADD COLUMN IF NOT EXISTS workspace_id text NULL;

UPDATE worker_registry_idempotency i
SET workspace_id = d.workspace_id
FROM worker_definitions d
WHERE i.workspace_id IS NULL
  AND i.definition_id = d.id
  AND i.tenant_id = d.tenant_id
  AND i.principal_type = d.principal_type
  AND i.principal_id = d.principal_id;

UPDATE worker_registry_idempotency i
SET workspace_id = v.workspace_id
FROM worker_versions v
WHERE i.workspace_id IS NULL
  AND i.version_id = v.id
  AND i.tenant_id = v.tenant_id
  AND i.principal_type = v.principal_type
  AND i.principal_id = v.principal_id;

-- A legacy claim without a result identity has no safe workspace inference. Do
-- not silently delete it: abort this transactional migration so an operator can
-- inspect the claim and the pre-migration schema remains intact.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM worker_registry_idempotency
    WHERE workspace_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot infer workspace for legacy Worker idempotency claim';
  END IF;
END
$$;

ALTER TABLE worker_registry_idempotency
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE worker_registry_idempotency
  DROP CONSTRAINT IF EXISTS worker_registry_idempotency_pkey;
ALTER TABLE worker_registry_idempotency
  ADD CONSTRAINT worker_registry_idempotency_pkey
  PRIMARY KEY (
    operation,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    idempotency_key
  );

CREATE UNIQUE INDEX IF NOT EXISTS worker_versions_owner_identity_workspace_uq
  ON worker_versions (
    id,
    definition_id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'worker_registry_idempotency_workspace_definition_fk'
  ) THEN
    ALTER TABLE worker_registry_idempotency
      ADD CONSTRAINT worker_registry_idempotency_workspace_definition_fk
      FOREIGN KEY (
        definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      ) REFERENCES worker_definitions (
        id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'worker_registry_idempotency_workspace_version_fk'
  ) THEN
    ALTER TABLE worker_registry_idempotency
      ADD CONSTRAINT worker_registry_idempotency_workspace_version_fk
      FOREIGN KEY (
        version_id,
        definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      ) REFERENCES worker_versions (
        id,
        definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1b. Coworker owner identity: include workspace in convergence and claims.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS agent_definitions_managed_owner_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_managed_owner_name_uq
  ON agent_definitions (
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    normalized_name
  )
  WHERE managed_discriminator = 'managed_agent_v1';

-- The historical Agent claim table predates workspace ownership. Infer the
-- immutable workspace from its completed Definition/Version result before
-- replacing the key. Incomplete claims cannot be safely assigned to a
-- workspace, so abort this transactional migration rather than guess.
ALTER TABLE agent_registry_idempotency
  ADD COLUMN IF NOT EXISTS workspace_id text NULL;

UPDATE agent_registry_idempotency i
SET workspace_id = d.workspace_id
FROM agent_definitions d
WHERE i.workspace_id IS NULL
  AND i.definition_id = d.id
  AND i.tenant_id = d.tenant_id
  AND i.principal_type = d.principal_type
  AND i.principal_id = d.principal_id;

UPDATE agent_registry_idempotency i
SET workspace_id = v.workspace_id
FROM agent_versions v
WHERE i.workspace_id IS NULL
  AND i.version_id = v.id
  AND i.tenant_id = v.tenant_id
  AND i.principal_type = v.principal_type
  AND i.principal_id = v.principal_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_registry_idempotency
    WHERE workspace_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot infer workspace for legacy Agent idempotency claim';
  END IF;
END
$$;

ALTER TABLE agent_registry_idempotency
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE agent_registry_idempotency
  DROP CONSTRAINT IF EXISTS agent_registry_idempotency_owner_definition_fk,
  DROP CONSTRAINT IF EXISTS agent_registry_idempotency_owner_version_fk,
  DROP CONSTRAINT IF EXISTS agent_registry_idempotency_pkey;

DROP INDEX IF EXISTS agent_definitions_owner_identity_uq;
DROP INDEX IF EXISTS agent_versions_owner_identity_uq;
CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_owner_identity_uq
  ON agent_definitions (id, tenant_id, workspace_id, principal_type, principal_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_owner_identity_uq
  ON agent_versions (
    id,
    definition_id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id
  );

ALTER TABLE agent_registry_idempotency
  ADD CONSTRAINT agent_registry_idempotency_pkey
  PRIMARY KEY (
    operation,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    idempotency_key
  );

ALTER TABLE agent_registry_idempotency
  ADD CONSTRAINT agent_registry_idempotency_owner_definition_fk
  FOREIGN KEY (
    definition_id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id
  ) REFERENCES agent_definitions (
    id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id
  ),
  ADD CONSTRAINT agent_registry_idempotency_owner_version_fk
  FOREIGN KEY (
    version_id,
    definition_id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id
  ) REFERENCES agent_versions (
    id,
    definition_id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id
  );

-- ---------------------------------------------------------------------------
-- 2. Agent Work Catalog: one exact Coworker owner + DefinitionVersion lineage.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_work_bindings
  ALTER COLUMN workspace_id TYPE uuid USING workspace_id::uuid;

ALTER TABLE agent_work_bindings
  ADD COLUMN IF NOT EXISTS principal_type text NULL,
  ADD COLUMN IF NOT EXISTS principal_id text NULL;

UPDATE agent_work_bindings a
SET principal_type = v.principal_type,
    principal_id = v.principal_id
FROM work_definition_source_versions v,
     agent_definitions ad
WHERE a.principal_type IS NULL
  AND v.id = a.active_work_definition_version_id
  AND v.definition_id = a.work_definition_id
  AND v.tenant_id = a.tenant_id
  AND v.workspace_id = a.workspace_id
  AND v.status = 'published'
  AND ad.id = a.agent_definition_id
  AND ad.tenant_id = a.tenant_id
  AND ad.workspace_id = a.workspace_id::text
  AND ad.principal_type = v.principal_type
  AND ad.principal_id = v.principal_id
  AND ad.managed_discriminator = 'managed_agent_v1';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_work_bindings a
    JOIN agent_definitions ad
      ON ad.id = a.agent_definition_id
     AND ad.tenant_id = a.tenant_id
    WHERE ad.workspace_id <> a.workspace_id::text
  ) THEN
    RAISE EXCEPTION 'Cannot migrate cross-workspace legacy Agent Work binding'
      USING DETAIL = 'Run scripts/ops/migrations/diagnose-semantic-closure.sql before retrying.';
  END IF;
END
$$;

-- Any pre-existing hybrid/foreign binding cannot be interpreted safely under
-- the new object model. Remove it rather than preserve two semantic authorities.
DELETE FROM agent_work_bindings
WHERE principal_type IS NULL OR principal_id IS NULL;

ALTER TABLE agent_work_bindings
  ALTER COLUMN principal_type SET NOT NULL,
  ALTER COLUMN principal_id SET NOT NULL;

ALTER TABLE agent_work_bindings
  DROP CONSTRAINT IF EXISTS agent_work_bindings_pkey;
ALTER TABLE agent_work_bindings
  ADD CONSTRAINT agent_work_bindings_pkey
  PRIMARY KEY (
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    agent_definition_id,
    work_definition_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_work_bindings_definition_owner_fk'
  ) THEN
    ALTER TABLE agent_work_bindings
      ADD CONSTRAINT agent_work_bindings_definition_owner_fk
      FOREIGN KEY (
        work_definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      ) REFERENCES work_definition_source_definitions (
        id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_work_bindings_version_lineage_fk'
  ) THEN
    ALTER TABLE agent_work_bindings
      ADD CONSTRAINT agent_work_bindings_version_lineage_fk
      FOREIGN KEY (
        active_work_definition_version_id,
        work_definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      ) REFERENCES work_definition_source_versions (
        id,
        definition_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id
      );
  END IF;
END
$$;

-- agent_definitions still stores workspace_id as text for historical reasons;
-- all four owner dimensions remain exact for a Catalog binding.
CREATE OR REPLACE FUNCTION validate_agent_work_binding_coworker_owner()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agent_definitions d
    WHERE d.id = NEW.agent_definition_id
      AND d.tenant_id = NEW.tenant_id
      AND d.workspace_id = NEW.workspace_id::text
      AND d.principal_type = NEW.principal_type
      AND d.principal_id = NEW.principal_id
      AND d.managed_discriminator = 'managed_agent_v1'
  ) THEN
    RAISE EXCEPTION 'Agent Work binding Coworker owner mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_work_bindings_coworker_owner_before_write
  ON agent_work_bindings;
CREATE TRIGGER agent_work_bindings_coworker_owner_before_write
  BEFORE INSERT OR UPDATE ON agent_work_bindings
  FOR EACH ROW EXECUTE FUNCTION validate_agent_work_binding_coworker_owner();

-- ---------------------------------------------------------------------------
-- 3. Repair orphan wake deliveries left by legacy Direct Conversation cleanup.
-- ---------------------------------------------------------------------------

DELETE FROM work_chat_wake_outbox o
WHERE o.delivered_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM conversation_work_links l
    WHERE l.tenant_id = o.tenant_id
      AND l.workspace_id = o.workspace_id
      AND l.work_id = o.work_id
      AND l.conversation_id = o.conversation_id
  );

COMMIT;
