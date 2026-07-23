BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_definitions
    WHERE managed_discriminator = 'managed_agent_v1'
      AND (
        normalized_name IS NULL
        OR octet_length(normalized_name) > 255
      )
  ) THEN
    RAISE EXCEPTION 'Managed agent definition data is invalid; migration aborted';
  END IF;
END
$$;

ALTER TABLE agent_definitions
  DROP CONSTRAINT IF EXISTS agent_definitions_managed_shape_check;

ALTER TABLE agent_definitions
  ADD CONSTRAINT agent_definitions_managed_shape_check CHECK ((
    (managed_discriminator IS NULL AND normalized_name IS NULL)
    OR (
      managed_discriminator = 'managed_agent_v1'
      AND normalized_name IS NOT NULL
      AND length(btrim(normalized_name)) > 0
      AND octet_length(normalized_name) <= 255
    )
  ) IS TRUE);

CREATE OR REPLACE FUNCTION prevent_managed_agent_definition_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.managed_discriminator IS NULL AND NEW.managed_discriminator IS NOT NULL THEN
    RAISE EXCEPTION 'Managed agent definitions may only be created by INSERT';
  END IF;
  IF OLD.managed_discriminator IS NOT NULL AND NEW.managed_discriminator IS NULL THEN
    RAISE EXCEPTION 'Managed agent definitions cannot be converted to legacy rows';
  END IF;
  IF OLD.managed_discriminator = 'managed_agent_v1'
     AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Managed agent definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_definitions_managed_immutable_before_update ON agent_definitions;
CREATE TRIGGER agent_definitions_managed_immutable_before_update
  BEFORE UPDATE ON agent_definitions FOR EACH ROW
  EXECUTE FUNCTION prevent_managed_agent_definition_mutation();

COMMIT;
