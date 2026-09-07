BEGIN;

-- The Work Chat wake checkpoint records the last card state observed for a
-- Work, so its vocabulary has to be the card's vocabulary. The card now
-- distinguishes a Work that has never been run ('not_started') and a Run that
-- has been requested but is not yet bound to its root Task ('starting') from
-- 'not_captured', which is reserved for a status we genuinely could not read.
-- Without this widening the wake worker's first observation of a freshly
-- created Work violates the check and the Work never reaches Chat at all.
--
-- The old constraint came from an inline column CHECK, so it is dropped by
-- catalog lookup rather than by a guessed generated name.
DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'work_chat_wake_states'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%last_observed_state%'
  LOOP
    EXECUTE format(
      'ALTER TABLE work_chat_wake_states DROP CONSTRAINT %I',
      existing.conname
    );
  END LOOP;
END $$;

-- work_chat_wake_outbox.product_state is deliberately NOT widened: only
-- 'complete', 'needs_you', and 'problem' are deliverable wakes, and neither
-- new state is a wake-worthy transition.
ALTER TABLE work_chat_wake_states
  ADD CONSTRAINT work_chat_wake_states_last_observed_state_check CHECK (
    last_observed_state IN (
      'not_started',
      'starting',
      'running',
      'needs_you',
      'complete',
      'problem',
      'not_captured'
    )
  );

COMMIT;
