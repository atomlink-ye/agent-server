BEGIN;

UPDATE team_messages
SET status = 'consumed'
WHERE status IN ('delivered', 'read');

ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_status_check;
ALTER TABLE team_messages ADD CONSTRAINT team_messages_status_check
  CHECK (status IN ('queued','consumed','acknowledged','cancelled'));

ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_kind_status_check;
ALTER TABLE team_messages ADD CONSTRAINT team_messages_kind_status_check CHECK (
  (
    kind IN ('wake','work_update')
    AND (
      (status='queued' AND consumed_by_task_id IS NULL AND consumed_at IS NULL)
      OR
      (status='consumed' AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL)
    )
  )
  OR
  (
    kind='direct'
    AND (
      (status='queued' AND consumed_by_task_id IS NULL AND consumed_at IS NULL AND acknowledged_at IS NULL AND cancelled_at IS NULL)
      OR
      (status='consumed' AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL AND acknowledged_at IS NULL AND cancelled_at IS NULL)
      OR
      (status='acknowledged' AND consumed_by_task_id IS NOT NULL AND consumed_at IS NOT NULL AND acknowledged_at IS NOT NULL AND cancelled_at IS NULL)
      OR
      (status='cancelled' AND cancelled_at IS NOT NULL)
    )
  )
);

COMMIT;
