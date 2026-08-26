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

-- Rows with no result identity represent abandoned/incomplete claims. They are
-- not durable Worker lifecycle facts and cannot be scoped safely after the
-- namespace split, so fail closed by dropping them before strengthening the key.
DELETE FROM worker_registry_idempotency
WHERE workspace_id IS NULL;

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
