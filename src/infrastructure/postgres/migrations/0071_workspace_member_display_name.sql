BEGIN;

-- A human principal has no durable row of their own anywhere in the schema
-- except this one, so the name a person is called by in a Conversation lives
-- here: resolved live at chat-turn-context time, never persisted onto a
-- durable message, so a rename always takes effect on the very next turn.
ALTER TABLE workspace_members ADD COLUMN display_name text;

COMMIT;
