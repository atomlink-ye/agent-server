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

-- Legacy claims with no resolvable Definition/Version identity cannot be
-- assigned a workspace and cause 0061 to abort rather than be discarded. These
-- queries intentionally use only columns present before 0061 runs.
SELECT
  'worker' AS claim_table,
  i.operation,
  i.tenant_id,
  i.principal_type,
  i.principal_id,
  i.idempotency_key,
  i.definition_id,
  i.version_id
FROM worker_registry_idempotency i
LEFT JOIN worker_definitions d
  ON d.id = i.definition_id
 AND d.tenant_id = i.tenant_id
 AND d.principal_type = i.principal_type
 AND d.principal_id = i.principal_id
LEFT JOIN worker_versions v
  ON v.id = i.version_id
 AND v.tenant_id = i.tenant_id
 AND v.principal_type = i.principal_type
 AND v.principal_id = i.principal_id
WHERE d.workspace_id IS NULL
  AND v.workspace_id IS NULL
UNION ALL
SELECT
  'agent' AS claim_table,
  i.operation,
  i.tenant_id,
  i.principal_type,
  i.principal_id,
  i.idempotency_key,
  i.definition_id,
  i.version_id
FROM agent_registry_idempotency i
LEFT JOIN agent_definitions d
  ON d.id = i.definition_id
 AND d.tenant_id = i.tenant_id
 AND d.principal_type = i.principal_type
 AND d.principal_id = i.principal_id
LEFT JOIN agent_versions v
  ON v.id = i.version_id
 AND v.tenant_id = i.tenant_id
 AND v.principal_type = i.principal_type
 AND v.principal_id = i.principal_id
WHERE d.workspace_id IS NULL
  AND v.workspace_id IS NULL
ORDER BY tenant_id, principal_type, principal_id, idempotency_key;
