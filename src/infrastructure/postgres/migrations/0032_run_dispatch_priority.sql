BEGIN;

ALTER TABLE run_dispatches
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

DO
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'run_dispatches_priority_check'
  ) THEN
    ALTER TABLE run_dispatches
      ADD CONSTRAINT run_dispatches_priority_check
      CHECK (priority IN ('normal', 'urgent'));
  END IF;
END
$$;

COMMIT;
