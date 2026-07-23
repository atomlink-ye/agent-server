BEGIN;
CREATE TABLE IF NOT EXISTS session_reset_idempotency (
  session_id uuid NOT NULL REFERENCES product_sessions(id),
  idempotency_key text NOT NULL,
  generation integer NOT NULL CHECK (generation >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, idempotency_key)
);
COMMIT;
