BEGIN;

-- Add scope_type and scope_id columns to agent_definitions table.
-- scope_type identifies the type of scope (e.g., 'principal' for principal-scoped visibility).
-- scope_id stores the identifier of the scope entity (initially the principal_id for backward compatibility).
-- Both columns are nullable; existing rows will be backfilled with 'principal' scope_type and principal_id as scope_id.
ALTER TABLE agent_definitions
  ADD COLUMN IF NOT EXISTS scope_type text NULL,
  ADD COLUMN IF NOT EXISTS scope_id text NULL;

-- Backfill existing managed agent rows with 'principal' scope type and principal_id as scope_id.
-- This maintains backward compatibility: existing principal-scoped agents remain visible only to their owner.
ALTER TABLE agent_definitions DISABLE TRIGGER agent_definitions_managed_immutable_before_update;

UPDATE agent_definitions
SET scope_type = 'principal', scope_id = principal_id
WHERE managed_discriminator = 'managed_agent_v1'
  AND scope_type IS NULL;

ALTER TABLE agent_definitions ENABLE TRIGGER agent_definitions_managed_immutable_before_update;

COMMIT;
