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
SELECT DISTINCT c.id
FROM conversations c
JOIN agent_identity_classes i
  ON i.tenant_id=c.tenant_id AND i.identity_class='legacy_work_internal'
JOIN conversation_members a
  ON a.conversation_id=c.id AND a.tenant_id=c.tenant_id
 AND a.member_type='agent_definition' AND a.member_id=i.agent_definition_id::text
JOIN conversation_members p
  ON p.conversation_id=c.id AND p.tenant_id=c.tenant_id
 AND p.member_type='principal'
WHERE c.kind='direct'
  AND c.direct_pair_key='direct:' || c.tenant_id || ':' || p.member_id || ':' || i.agent_definition_id::text;

DELETE FROM chat_activation_causes WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM chat_dispatches WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_reads WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_work_entitlements WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_work_links WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversation_members WHERE conversation_id IN (SELECT id FROM legacy_work_internal_conversations);
DELETE FROM conversations WHERE id IN (SELECT id FROM legacy_work_internal_conversations);

ALTER TABLE team_versions DROP CONSTRAINT IF EXISTS team_versions_spec_shape_check;
CREATE OR REPLACE FUNCTION team_version_spec_shape_is_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN value IS NULL OR jsonb_typeof(value) <> 'object' THEN false
    WHEN jsonb_typeof(value -> 'lead') <> 'object' THEN false
    WHEN jsonb_typeof(value -> 'roster') <> 'array' THEN false
    WHEN jsonb_array_length(value -> 'roster') NOT BETWEEN 1 AND 16 THEN false
    WHEN nullif(btrim(value #>> '{lead,name}'), '') IS NULL THEN false
    WHEN nullif(btrim(value #>> '{lead,workerVersionId}'), '') IS NULL THEN false
    WHEN nullif(btrim(value ->> 'environmentVersionId'), '') IS NULL THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value -> 'roster') AS member
      WHERE nullif(btrim(member ->> 'name'), '') IS NULL
         OR nullif(btrim(member ->> 'workerVersionId'), '') IS NULL
    )
  END;
$$;
ALTER TABLE team_versions ADD CONSTRAINT team_versions_spec_shape_check
  CHECK (team_version_spec_shape_is_valid(spec));

COMMIT;
