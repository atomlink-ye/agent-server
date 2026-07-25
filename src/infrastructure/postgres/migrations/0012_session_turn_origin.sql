BEGIN;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_ref text NULL;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS origin_ref text NULL;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS session_id uuid NULL;

UPDATE admissions AS admissions_row
SET session_id = tasks_row.session_id
FROM tasks AS tasks_row
WHERE admissions_row.task_id = tasks_row.id
  AND admissions_row.session_id IS NULL
  AND tasks_row.session_id IS NOT NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_ingress_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_origin_ref_check;
ALTER TABLE admissions DROP CONSTRAINT IF EXISTS admissions_ingress_check;
ALTER TABLE admissions DROP CONSTRAINT IF EXISTS admissions_origin_ref_check;
ALTER TABLE admissions DROP CONSTRAINT IF EXISTS admissions_session_id_fk;
ALTER TABLE admissions DROP CONSTRAINT IF EXISTS admissions_owner_scope_idempotency_key_key;

ALTER TABLE tasks ADD CONSTRAINT tasks_ingress_check
  CHECK (ingress IN ('api', 'lark'));
ALTER TABLE tasks ADD CONSTRAINT tasks_origin_ref_check
  CHECK (
    (ingress = 'api' AND origin_ref IS NULL) OR
    (ingress = 'lark' AND origin_ref IS NOT NULL AND length(trim(origin_ref)) > 0)
  );

ALTER TABLE admissions ADD CONSTRAINT admissions_ingress_check
  CHECK (ingress IN ('api', 'lark'));
ALTER TABLE admissions ADD CONSTRAINT admissions_origin_ref_check
  CHECK (
    (ingress = 'api' AND origin_ref IS NULL) OR
    (ingress = 'lark' AND origin_ref IS NOT NULL AND length(trim(origin_ref)) > 0)
  );

ALTER TABLE admissions ADD CONSTRAINT admissions_session_id_fk
  FOREIGN KEY (session_id) REFERENCES product_sessions(id);

CREATE UNIQUE INDEX IF NOT EXISTS admissions_owner_idempotency_non_session_key
  ON admissions (ingress, tenant_id, workspace_id, principal_type, principal_id, idempotency_key)
  WHERE session_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admissions_owner_session_idempotency_key
  ON admissions (ingress, tenant_id, workspace_id, principal_type, principal_id, session_id, idempotency_key)
  WHERE session_id IS NOT NULL;

COMMIT;
