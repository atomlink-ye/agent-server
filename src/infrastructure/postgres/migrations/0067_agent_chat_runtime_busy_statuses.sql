BEGIN;

-- Widen the Coworker chat runtime status to distinguish a Coworker that is
-- actively reasoning ('thinking') or executing ('working') from the prior
-- three-value lifecycle. No writer sets these two values yet -- the chat
-- dispatch/turn loop that would report live busyness is out of scope here --
-- this migration only makes room for that future writer.
ALTER TABLE agent_chat_runtimes
  DROP CONSTRAINT IF EXISTS agent_chat_runtimes_status_check,
  ADD CONSTRAINT agent_chat_runtimes_status_check CHECK (
    status IN ('available', 'draining', 'unavailable', 'working', 'thinking')
  );

COMMIT;
