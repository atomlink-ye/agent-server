BEGIN;

-- RuntimeSessionGeneration is the sole provider identity authority. The old
-- per-Run table is retired without backfill or a compatibility view.
ALTER TABLE IF EXISTS runtime_session_bindings
  DROP CONSTRAINT IF EXISTS runtime_session_bindings_pkey,
  DROP CONSTRAINT IF EXISTS runtime_session_bindings_run_id_fkey;

DROP INDEX IF EXISTS runtime_session_bindings_run_id_idx;
DROP INDEX IF EXISTS runtime_session_bindings_pkey;
DROP TABLE IF EXISTS runtime_session_bindings;

COMMIT;
