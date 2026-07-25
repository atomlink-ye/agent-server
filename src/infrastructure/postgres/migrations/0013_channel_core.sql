BEGIN;

CREATE TABLE IF NOT EXISTS channel_ingress_events (
  id text PRIMARY KEY,
  connection_key text NOT NULL CHECK (octet_length(connection_key) BETWEEN 1 AND 512),
  kind text NOT NULL CHECK (kind IN ('message', 'card_action', 'command')),
  external_key text NOT NULL CHECK (octet_length(external_key) BETWEEN 1 AND 512),
  provider_event_id text CHECK (provider_event_id IS NULL OR octet_length(provider_event_id) BETWEEN 1 AND 512),
  external_message_id text CHECK (external_message_id IS NULL OR octet_length(external_message_id) BETWEEN 1 AND 512),
  chat_id text NOT NULL CHECK (octet_length(chat_id) BETWEEN 1 AND 512),
  root_message_id text CHECK (root_message_id IS NULL OR octet_length(root_message_id) BETWEEN 1 AND 512),
  thread_id text CHECK (thread_id IS NULL OR octet_length(thread_id) BETWEEN 1 AND 512),
  reply_to_id text CHECK (reply_to_id IS NULL OR octet_length(reply_to_id) BETWEEN 1 AND 512),
  external_actor_id text CHECK (external_actor_id IS NULL OR octet_length(external_actor_id) BETWEEN 1 AND 512),
  text text CHECK (text IS NULL OR octet_length(text) <= 8192),
  action jsonb CHECK (action IS NULL OR octet_length(action::text) <= 8192),
  bot_mention_verified boolean,
  normalization_version text NOT NULL CHECK (octet_length(normalization_version) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text CHECK (lease_owner IS NULL OR octet_length(lease_owner) BETWEEN 1 AND 256),
  lease_expires_at timestamptz,
  safe_error_code text CHECK (safe_error_code IS NULL OR octet_length(safe_error_code) BETWEEN 1 AND 256),
  admitted_session_id uuid REFERENCES product_sessions(id),
  admitted_task_id uuid REFERENCES tasks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_key, kind, external_key),
  CHECK (
    (status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);
ALTER TABLE channel_ingress_events
  ADD COLUMN IF NOT EXISTS bot_mention_verified boolean;

CREATE TABLE IF NOT EXISTS channel_conversation_bindings (
  id text PRIMARY KEY,
  connection_key text NOT NULL CHECK (octet_length(connection_key) BETWEEN 1 AND 512),
  chat_id text NOT NULL CHECK (octet_length(chat_id) BETWEEN 1 AND 512),
  root_message_id text NOT NULL CHECK (octet_length(root_message_id) BETWEEN 1 AND 512),
  session_id uuid REFERENCES product_sessions(id),
  creating_ingress_id text NOT NULL REFERENCES channel_ingress_events(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_key, chat_id, root_message_id)
);

CREATE TABLE IF NOT EXISTS channel_outbox (
  id text PRIMARY KEY,
  connection_key text NOT NULL CHECK (octet_length(connection_key) BETWEEN 1 AND 512),
  binding_id text REFERENCES channel_conversation_bindings(id),
  target_id text NOT NULL CHECK (octet_length(target_id) BETWEEN 1 AND 512),
  delivery_kind text NOT NULL CHECK (octet_length(delivery_kind) BETWEEN 1 AND 128),
  aggregate_id text NOT NULL CHECK (octet_length(aggregate_id) BETWEEN 1 AND 512),
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 1),
  payload text NOT NULL CHECK (octet_length(payload) <= 8192),
  provider_request_id text NOT NULL CHECK (octet_length(provider_request_id) BETWEEN 1 AND 512),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'retry_wait', 'delivered', 'permanent_failed', 'delivery_unknown')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text CHECK (lease_owner IS NULL OR octet_length(lease_owner) BETWEEN 1 AND 256),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  last_safe_error text CHECK (last_safe_error IS NULL OR octet_length(last_safe_error) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_key, delivery_kind, aggregate_id, aggregate_version),
  CHECK (
    (status = 'sending' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'sending' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK ((status = 'retry_wait') = (next_attempt_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS channel_delivery_attempts (
  id text PRIMARY KEY,
  outbox_id text NOT NULL REFERENCES channel_outbox(id),
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  provider_request_id text CHECK (provider_request_id IS NULL OR octet_length(provider_request_id) BETWEEN 1 AND 512),
  provider_message_id text CHECK (provider_message_id IS NULL OR octet_length(provider_message_id) BETWEEN 1 AND 512),
  result text NOT NULL CHECK (result IN ('delivered', 'retryable_failure', 'permanent_failure', 'unknown')),
  safe_error_code text CHECK (safe_error_code IS NULL OR octet_length(safe_error_code) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS channel_ingress_claim_idx
  ON channel_ingress_events (status, lease_expires_at, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS channel_ingress_provider_message_idx
  ON channel_ingress_events (connection_key, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS channel_outbox_claim_idx
  ON channel_outbox (status, next_attempt_at, lease_expires_at, created_at, id);

COMMIT;
