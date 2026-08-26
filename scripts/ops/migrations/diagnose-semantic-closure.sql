-- Read-only diagnostics for a failed 0061_semantic_closure migration.
-- Run this against the same database after the migration transaction rolls back.

-- Legacy catalog bindings whose Coworker workspace differs from the binding
-- workspace must be repaired or explicitly retired before retrying 0061.
SELECT
  a.tenant_id,
  a.workspace_id,
  a.agent_definition_id,
  a.work_definition_id,
  ad.workspace_id AS agent_workspace_id,
  ad.principal_type,
  ad.principal_id
FROM agent_work_bindings a
JOIN agent_definitions ad
  ON ad.id = a.agent_definition_id
 AND ad.tenant_id = a.tenant_id
WHERE ad.workspace_id <> a.workspace_id::text
ORDER BY a.tenant_id, a.workspace_id, a.agent_definition_id, a.work_definition_id;

-- Legacy claims with no completed Definition/Version identity cannot be
-- assigned a workspace and cause 0061 to abort rather than be discarded.
SELECT
  operation,
  tenant_id,
  principal_type,
  principal_id,
  idempotency_key,
  definition_id,
  version_id
FROM worker_registry_idempotency
WHERE workspace_id IS NULL
ORDER BY tenant_id, principal_type, principal_id, idempotency_key;
