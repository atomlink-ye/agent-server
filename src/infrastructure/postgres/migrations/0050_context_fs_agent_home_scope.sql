BEGIN;

-- Extend the released ContextFS scope contract for Agent Home projections.
-- Existing rows are intentionally left in place; the new kind is a separate
-- namespace whose key includes agent_definition_id, namespace, and scope_key.
ALTER TABLE context_entries
  DROP CONSTRAINT IF EXISTS context_entries_scope_kind_check;

ALTER TABLE context_entries
  ADD CONSTRAINT context_entries_scope_kind_check CHECK (
    scope_kind IN (
      'organization',
      'workspace',
      'agent',
      'agent_home',
      'agent_user',
      'conversation',
      'work',
      'runtime_scratch'
    )
  );

COMMIT;
