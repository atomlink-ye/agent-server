BEGIN;

CREATE TABLE IF NOT EXISTS agent_workflow_associations (
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  agent_definition_id text NOT NULL,
  work_definition_id uuid NOT NULL REFERENCES work_definition_source_definitions(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, agent_definition_id, work_definition_id)
);

COMMIT;
