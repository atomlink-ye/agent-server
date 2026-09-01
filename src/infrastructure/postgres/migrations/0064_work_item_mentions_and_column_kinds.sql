BEGIN;

-- What a Board column MEANS, as opposed to what it is called. NULL is the
-- honest answer for a column whose meaning is not declared, and it is the
-- default: an unclassified column never participates in a claim advance.
ALTER TABLE product_work_board_columns
  ADD COLUMN IF NOT EXISTS kind text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_work_board_columns_kind_check'
  ) THEN
    ALTER TABLE product_work_board_columns
      ADD CONSTRAINT product_work_board_columns_kind_check
      CHECK (kind IS NULL OR kind IN ('todo','doing','done'));
  END IF;
END
$$;

-- Backfill EXACT case-insensitive title matches only. A board titled
-- "Backlog / In flight / Shipped" stays NULL on purpose: a fuzzy guess here
-- would silently start moving a user's WorkItems on claim.
UPDATE product_work_board_columns
   SET kind = 'todo'
 WHERE kind IS NULL AND lower(btrim(title)) IN ('todo','to do');
UPDATE product_work_board_columns
   SET kind = 'doing'
 WHERE kind IS NULL AND lower(btrim(title)) = 'doing';
UPDATE product_work_board_columns
   SET kind = 'done'
 WHERE kind IS NULL AND lower(btrim(title)) = 'done';

-- Mentions parsed from prose at every write. Stored so a reader never has to
-- re-parse, and so an update can tell a NEW mention from prose that merely got
-- re-saved. jsonb array of identity strings; '[]' means "parsed, none found".
ALTER TABLE product_work_items
  ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE product_work_item_comments
  ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_work_items_mentions_array_check'
  ) THEN
    ALTER TABLE product_work_items
      ADD CONSTRAINT product_work_items_mentions_array_check
      CHECK (jsonb_typeof(mentions) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_work_item_comments_mentions_array_check'
  ) THEN
    ALTER TABLE product_work_item_comments
      ADD CONSTRAINT product_work_item_comments_mentions_array_check
      CHECK (jsonb_typeof(mentions) = 'array');
  END IF;
END
$$;

COMMIT;
