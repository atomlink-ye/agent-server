BEGIN;

-- Add role_label and summary columns to agent_definitions table.
-- role_label stores the agent's role designation (e.g., "Validator", "Executor").
-- summary stores a brief description of the agent's purpose.
-- Both are nullable; existing rows will have NULL values.
ALTER TABLE agent_definitions
  ADD COLUMN IF NOT EXISTS role_label text NULL,
  ADD COLUMN IF NOT EXISTS summary text NULL;

-- Backfill summary from the earliest agent_versions.description for managed agents.
-- This captures the agent's description from its package metadata into the definition row.
ALTER TABLE agent_definitions DISABLE TRIGGER agent_definitions_managed_immutable_before_update;

UPDATE agent_definitions ad
SET summary = (
  SELECT av.description
  FROM agent_versions av
  WHERE av.definition_id = ad.id
    AND av.managed_discriminator = 'managed_agent_v1'
  ORDER BY av.created_at ASC
  LIMIT 1
)
WHERE ad.managed_discriminator = 'managed_agent_v1'
  AND ad.summary IS NULL;

ALTER TABLE agent_definitions ENABLE TRIGGER agent_definitions_managed_immutable_before_update;

COMMIT;
