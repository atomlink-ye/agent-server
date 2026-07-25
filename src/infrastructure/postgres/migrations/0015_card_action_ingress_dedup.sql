BEGIN;

DROP INDEX IF EXISTS channel_ingress_provider_message_idx;
CREATE UNIQUE INDEX channel_ingress_provider_message_idx
  ON channel_ingress_events (connection_key, external_message_id)
  WHERE external_message_id IS NOT NULL AND kind <> 'card_action';

COMMIT;
