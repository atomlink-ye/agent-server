BEGIN;

DROP TABLE IF EXISTS compiled_team_plans;
DROP TABLE IF EXISTS team_node_executions;
DROP TABLE IF EXISTS team_executions;

-- A direct migration replay may observe the post-cutover schema. Reintroduce a
-- nullable discriminator only for the guarded cleanup below, then drop it at
-- the end again. Existing canonical rows receive NULL and are retained.
ALTER TABLE team_runs ADD COLUMN IF NOT EXISTS execution_mode text;

-- Only agentic_mve rows implement the retained TeamDriver contract. Remove
-- collaborative runtime state in dependency order before dropping the mode.
UPDATE tasks
   SET source_team_message_id = NULL
 WHERE source_team_message_id IN (
   SELECT message.id FROM team_messages message
   JOIN team_runs team ON team.id = message.team_run_id
   WHERE team.execution_mode <> 'agentic_mve'
 );
UPDATE tasks
   SET team_member_run_id = NULL
 WHERE team_member_run_id IN (
   SELECT member.id FROM team_member_runs member
   JOIN team_runs team ON team.id = member.team_run_id
   WHERE team.execution_mode <> 'agentic_mve'
 );
DELETE FROM learning_proposals
 WHERE source_team_run_id IN (
   SELECT id FROM team_runs WHERE execution_mode <> 'agentic_mve'
 );
DELETE FROM team_work_item_dependencies
 WHERE team_run_id IN (
   SELECT id FROM team_runs WHERE execution_mode <> 'agentic_mve'
 );
DELETE FROM team_messages
 WHERE team_run_id IN (
   SELECT id FROM team_runs WHERE execution_mode <> 'agentic_mve'
 );
DELETE FROM team_work_item_attempts
 WHERE team_run_id IN (
   SELECT id FROM team_runs WHERE execution_mode <> 'agentic_mve'
 );
DELETE FROM team_work_items
 WHERE team_run_id IN (
   SELECT id FROM team_runs WHERE execution_mode <> 'agentic_mve'
 );
DELETE FROM team_member_runs
 WHERE team_run_id IN (
   SELECT id FROM team_runs WHERE execution_mode <> 'agentic_mve'
 );
DELETE FROM team_runs WHERE execution_mode <> 'agentic_mve';

ALTER TABLE team_versions ADD COLUMN IF NOT EXISTS spec jsonb;
-- Published versions are immutable during normal operation. Disable the
-- trigger only for this schema-conversion update; transactional DDL ensures a
-- failed migration cannot leave the protection disabled.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'team_versions'::regclass
      AND tgname = 'team_versions_immutable_before_update'
  ) THEN
    ALTER TABLE team_versions DISABLE TRIGGER team_versions_immutable_before_update;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'team_versions'
      AND column_name = 'collaboration_spec'
  ) THEN
    EXECUTE $sql$
      UPDATE team_versions SET spec = collaboration_spec
       WHERE spec IS NULL
         AND collaboration_spec IS NOT NULL
         AND execution_mode = 'agentic_mve'
    $sql$;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'team_versions'::regclass
      AND tgname = 'team_versions_immutable_before_update'
  ) THEN
    ALTER TABLE team_versions ENABLE TRIGGER team_versions_immutable_before_update;
  END IF;
END $$;

DELETE FROM team_registry_idempotency
 WHERE version_id IN (SELECT id FROM team_versions WHERE spec IS NULL);
DELETE FROM team_versions WHERE spec IS NULL;
ALTER TABLE team_versions ALTER COLUMN spec SET NOT NULL;
ALTER TABLE team_versions ALTER COLUMN environment_version_id SET NOT NULL;
ALTER TABLE team_versions
  DROP CONSTRAINT IF EXISTS team_versions_spec_shape_check;
ALTER TABLE team_versions ADD CONSTRAINT team_versions_spec_shape_check CHECK (
  COALESCE(CASE
    WHEN jsonb_typeof(spec) = 'object'
      AND jsonb_typeof(spec->'lead') = 'object'
      AND jsonb_typeof(spec->'roster') = 'array'
      AND jsonb_array_length(spec->'roster') = 2
    THEN
      length(btrim(spec#>>'{lead,name}')) > 0
      AND spec#>>'{lead,name}' = btrim(spec#>>'{lead,name}')
      AND length(spec#>>'{lead,agentVersionId}') > 0
      AND length(btrim(spec#>>'{roster,0,name}')) > 0
      AND spec#>>'{roster,0,name}' = btrim(spec#>>'{roster,0,name}')
      AND length(spec#>>'{roster,0,agentVersionId}') > 0
      AND length(btrim(spec#>>'{roster,1,name}')) > 0
      AND spec#>>'{roster,1,name}' = btrim(spec#>>'{roster,1,name}')
      AND length(spec#>>'{roster,1,agentVersionId}') > 0
      AND spec#>>'{lead,name}' <> spec#>>'{roster,0,name}'
      AND spec#>>'{lead,name}' <> spec#>>'{roster,1,name}'
      AND spec#>>'{roster,0,name}' <> spec#>>'{roster,1,name}'
      AND spec->>'environmentVersionId' = environment_version_id::text
    ELSE false
  END, false)
);

ALTER TABLE team_versions
  DROP CONSTRAINT IF EXISTS team_versions_execution_shape_check,
  DROP CONSTRAINT IF EXISTS team_versions_execution_mode_check,
  DROP COLUMN IF EXISTS graph,
  DROP COLUMN IF EXISTS execution_mode,
  DROP COLUMN IF EXISTS collaboration_spec;

ALTER TABLE team_runs DROP COLUMN IF EXISTS execution_mode;

COMMIT;
