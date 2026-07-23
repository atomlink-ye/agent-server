BEGIN;

SELECT pg_advisory_xact_lock(hashtext('workspace_memory_runtime_provenance_integrity'));

CREATE OR REPLACE FUNCTION validate_workspace_memory_runtime_provenance()
RETURNS trigger AS $$
BEGIN
  IF NEW.source_run_id IS NULL
     AND NEW.source_message_id IS NULL
     AND NEW.source_agent_version_id IS NULL
     AND NEW.source_candidate_index IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source_message_id IS NULL
     OR NEW.source_task_id IS NULL
     OR NEW.source_run_id IS NULL
     OR NEW.source_agent_version_id IS NULL
     OR NEW.source_candidate_index IS NULL THEN
    RAISE EXCEPTION 'Runtime memory proposal provenance must contain all five fields';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM messages AS m
    JOIN product_sessions AS ps
      ON ps.id = m.session_id
    JOIN workspaces AS w
      ON w.id = ps.workspace_id
    JOIN tasks AS t
      ON t.id = m.task_id
     AND t.session_id = ps.id
     AND t.id = NEW.source_task_id
    JOIN runs AS r
      ON r.id = NEW.source_run_id
     AND r.task_id = t.id
    JOIN agent_versions AS av
      ON av.id = NEW.source_agent_version_id
    WHERE m.id = NEW.source_message_id
      AND t.invokable_kind = 'agent'
      AND t.invokable_version_id = av.id::text
      AND ps.tenant_id = t.tenant_id
      AND ps.principal_type = t.principal_type
      AND ps.principal_id = t.principal_id
      AND ps.workspace_id::text = t.workspace_id
      AND w.tenant_id = ps.tenant_id
      AND w.principal_type = ps.principal_type
      AND w.principal_id = ps.principal_id
      AND w.tenant_id = t.tenant_id
      AND w.principal_type = t.principal_type
      AND w.principal_id = t.principal_id
      AND NEW.tenant_id = ps.tenant_id
      AND NEW.tenant_id = w.tenant_id
      AND NEW.principal_type = ps.principal_type
      AND NEW.principal_type = w.principal_type
      AND NEW.principal_id = ps.principal_id
      AND NEW.principal_id = w.principal_id
      AND NEW.workspace_id = ps.workspace_id::text
      AND NEW.workspace_id = w.id::text
      AND av.tenant_id = ps.tenant_id
      AND av.principal_type = ps.principal_type
      AND av.principal_id = ps.principal_id
      AND av.workspace_id = ps.workspace_id::text
      AND av.tenant_id = w.tenant_id
      AND av.principal_type = w.principal_type
      AND av.principal_id = w.principal_id
      AND av.workspace_id = w.id::text
  ) THEN
    RAISE EXCEPTION 'Runtime memory proposal provenance does not match one durable owned tuple';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspace_memory_proposals_runtime_provenance_integrity
  ON workspace_memory_proposals;
CREATE TRIGGER workspace_memory_proposals_runtime_provenance_integrity
  BEFORE INSERT OR UPDATE ON workspace_memory_proposals
  FOR EACH ROW
  EXECUTE FUNCTION validate_workspace_memory_runtime_provenance();

COMMIT;
