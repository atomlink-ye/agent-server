BEGIN;

CREATE TABLE IF NOT EXISTS agent_identity_classes (
  tenant_id text NOT NULL,
  agent_definition_id uuid NOT NULL,
  identity_class text NOT NULL CHECK (identity_class IN ('coworker','legacy_work_internal')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,agent_definition_id)
);

INSERT INTO agent_identity_classes (tenant_id,agent_definition_id,identity_class,created_at,updated_at)
SELECT i.tenant_id,i.definition_id,'legacy_work_internal',i.created_at,i.updated_at
FROM agent_registry_idempotency i
WHERE i.operation='import' AND i.definition_id IS NOT NULL
  AND i.idempotency_key LIKE 'work-inline-agent-import:%'
ON CONFLICT (tenant_id,agent_definition_id) DO UPDATE
SET identity_class='legacy_work_internal',updated_at=EXCLUDED.updated_at;

INSERT INTO agent_identity_classes (tenant_id,agent_definition_id,identity_class,created_at,updated_at)
SELECT d.tenant_id,d.id,'coworker',d.created_at,d.updated_at
FROM agent_definitions d
WHERE d.managed_discriminator='managed_agent_v1'
ON CONFLICT (tenant_id,agent_definition_id) DO NOTHING;

CREATE OR REPLACE FUNCTION classify_managed_agent_as_coworker()
RETURNS trigger AS $$
BEGIN
  IF NEW.managed_discriminator='managed_agent_v1' THEN
    INSERT INTO agent_identity_classes (tenant_id,agent_definition_id,identity_class,created_at,updated_at)
    VALUES (NEW.tenant_id,NEW.id,'coworker',NEW.created_at,NEW.updated_at)
    ON CONFLICT (tenant_id,agent_definition_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_definitions_classify_coworker_after_insert ON agent_definitions;
CREATE TRIGGER agent_definitions_classify_coworker_after_insert
AFTER INSERT ON agent_definitions FOR EACH ROW EXECUTE FUNCTION classify_managed_agent_as_coworker();

DELETE FROM agent_chat_runtimes r
USING agent_identity_classes c
WHERE c.tenant_id=r.tenant_id AND c.agent_definition_id::text=r.agent_definition_id
  AND c.identity_class='legacy_work_internal';

CREATE TEMP TABLE legacy_work_internal_conversations ON COMMIT DROP AS
SELECT c.id FROM conversations c JOIN agent_identity_classes i
  ON i.tenant_id=c.tenant_id AND i.identity_class='legacy_work_internal'
WHERE c.direct_pair_key LIKE '%' || i.agent_definition_id::text || '%';

DELETE FROM chat_activation_causes WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM chat_dispatches WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_reads WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_work_entitlements WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_work_links WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_members WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversations WHERE id IN (SELECT id FROM legacy_work_internal_conversations);

COMMIT;
