BEGIN;

-- Cross-turn loop breaker for WorkItem mention wakes: how many agent-caused
-- wakes this WorkItem has accumulated since a human last caused one. A
-- human-caused wake resets the counter; wakeMentionedAgents refuses to wake
-- past the hard cap until a human re-engages. See wake-loop-guard.ts.
CREATE TABLE IF NOT EXISTS work_item_wake_loop_counters (
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  agent_wake_count integer NOT NULL DEFAULT 0 CHECK (agent_wake_count >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, work_item_id)
);

COMMIT;
