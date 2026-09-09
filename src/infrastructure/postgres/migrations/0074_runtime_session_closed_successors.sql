BEGIN;

-- Closed RuntimeSession rows remain durable history. Only an active row owns a
-- logical scope, so a later ensure can create its successor without deleting
-- the prior session or its immutable specs/generations.
DROP INDEX IF EXISTS runtime_sessions_scope_uq;

CREATE UNIQUE INDEX runtime_sessions_scope_uq
  ON runtime_sessions (
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    scope_kind,
    scope_id,
    COALESCE(scope_epoch, 0)
  )
  WHERE status <> 'closed';

COMMIT;
