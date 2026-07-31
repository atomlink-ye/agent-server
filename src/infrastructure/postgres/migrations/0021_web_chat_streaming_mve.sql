BEGIN;
ALTER TABLE run_events DROP CONSTRAINT IF EXISTS run_events_run_id_type_key;
COMMIT;
