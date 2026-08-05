BEGIN;

ALTER TABLE team_versions
  DROP CONSTRAINT IF EXISTS team_versions_spec_shape_check;

ALTER TABLE team_versions
  ADD CONSTRAINT team_versions_spec_shape_check CHECK (
    COALESCE(CASE
      WHEN jsonb_typeof(spec) = 'object'
        AND jsonb_typeof(spec->'lead') = 'object'
        AND jsonb_typeof(spec->'roster') = 'array'
        AND jsonb_array_length(spec->'roster') >= 1
      THEN
        length(btrim(spec#>>'{lead,name}')) > 0
        AND spec#>>'{lead,name}' = btrim(spec#>>'{lead,name}')
        AND length(spec#>>'{lead,agentVersionId}') > 0
        AND spec->>'environmentVersionId' = environment_version_id::text
      ELSE false
    END, false)
  );

COMMIT;
