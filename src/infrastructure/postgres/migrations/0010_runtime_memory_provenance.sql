BEGIN;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_message_id uuid NULL;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_run_id uuid NULL;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_agent_version_id uuid NULL;
ALTER TABLE workspace_memory_proposals ADD COLUMN IF NOT EXISTS source_candidate_index integer NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_message_id uuid NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_run_id uuid NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_agent_version_id uuid NULL;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS source_candidate_index integer NULL;
ALTER TABLE workspace_memory_owned_entries ADD COLUMN IF NOT EXISTS source_message_id uuid NULL;
ALTER TABLE workspace_memory_owned_entries ADD COLUMN IF NOT EXISTS source_run_id uuid NULL;
ALTER TABLE workspace_memory_owned_entries ADD COLUMN IF NOT EXISTS source_agent_version_id uuid NULL;
ALTER TABLE workspace_memory_owned_entries ADD COLUMN IF NOT EXISTS source_candidate_index integer NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_memory_proposals_runtime_replay
  ON workspace_memory_proposals(source_run_id, source_candidate_index)
  WHERE source_run_id IS NOT NULL AND source_candidate_index IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_proposals_source_message_fk') THEN
    ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_source_message_fk FOREIGN KEY (source_message_id) REFERENCES messages(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_proposals_source_task_fk') THEN
    ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_source_task_fk FOREIGN KEY (source_task_id) REFERENCES tasks(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_proposals_source_run_fk') THEN
    ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_source_run_fk FOREIGN KEY (source_run_id) REFERENCES runs(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_proposals_source_agent_version_fk') THEN
    ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_source_agent_version_fk FOREIGN KEY (source_agent_version_id) REFERENCES agent_versions(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_proposals_runtime_provenance_shape_check') THEN
    ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_runtime_provenance_shape_check
      CHECK (source_run_id IS NULL OR (source_candidate_index IS NOT NULL AND source_task_id IS NOT NULL AND source_agent_version_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_entries_runtime_provenance_shape_check') THEN
    ALTER TABLE workspace_memory_entries ADD CONSTRAINT workspace_memory_entries_runtime_provenance_shape_check
      CHECK (source_run_id IS NULL OR (source_candidate_index IS NOT NULL AND source_task_id IS NOT NULL AND source_agent_version_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_owned_entries_runtime_provenance_shape_check') THEN
    ALTER TABLE workspace_memory_owned_entries ADD CONSTRAINT workspace_memory_owned_entries_runtime_provenance_shape_check
      CHECK (source_run_id IS NULL OR (source_candidate_index IS NOT NULL AND source_task_id IS NOT NULL AND source_agent_version_id IS NOT NULL));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_owned_entries_source_message_fk') THEN
    ALTER TABLE workspace_memory_owned_entries ADD CONSTRAINT workspace_memory_owned_entries_source_message_fk FOREIGN KEY (source_message_id) REFERENCES messages(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_owned_entries_source_task_fk') THEN
    ALTER TABLE workspace_memory_owned_entries ADD CONSTRAINT workspace_memory_owned_entries_source_task_fk FOREIGN KEY (source_task_id) REFERENCES tasks(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_owned_entries_source_run_fk') THEN
    ALTER TABLE workspace_memory_owned_entries ADD CONSTRAINT workspace_memory_owned_entries_source_run_fk FOREIGN KEY (source_run_id) REFERENCES runs(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_owned_entries_source_agent_version_fk') THEN
    ALTER TABLE workspace_memory_owned_entries ADD CONSTRAINT workspace_memory_owned_entries_source_agent_version_fk FOREIGN KEY (source_agent_version_id) REFERENCES agent_versions(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_entries_source_message_fk') THEN
    ALTER TABLE workspace_memory_entries ADD CONSTRAINT workspace_memory_entries_source_message_fk FOREIGN KEY (source_message_id) REFERENCES messages(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_entries_source_task_fk') THEN
    ALTER TABLE workspace_memory_entries ADD CONSTRAINT workspace_memory_entries_source_task_fk FOREIGN KEY (source_task_id) REFERENCES tasks(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_entries_source_run_fk') THEN
    ALTER TABLE workspace_memory_entries ADD CONSTRAINT workspace_memory_entries_source_run_fk FOREIGN KEY (source_run_id) REFERENCES runs(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_entries_source_agent_version_fk') THEN
    ALTER TABLE workspace_memory_entries ADD CONSTRAINT workspace_memory_entries_source_agent_version_fk FOREIGN KEY (source_agent_version_id) REFERENCES agent_versions(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_proposals_candidate_index_check') THEN
    ALTER TABLE workspace_memory_proposals ADD CONSTRAINT workspace_memory_proposals_candidate_index_check CHECK (source_candidate_index IS NULL OR source_candidate_index >= 0);
  END IF;
END $$;
COMMIT;
