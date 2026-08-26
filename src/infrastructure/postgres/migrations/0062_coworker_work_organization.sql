BEGIN;

CREATE TABLE IF NOT EXISTS product_work_items (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'todo',
  assignee_id text NULL,
  created_by text NOT NULL,
  source_conversation_id uuid NULL,
  source_message_id uuid NULL,
  linked_work_id uuid NULL REFERENCES works(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT product_work_items_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT product_work_items_status_check CHECK (status IN ('todo','in_progress','in_review','done')),
  CONSTRAINT product_work_items_source_pair_check CHECK (
    (source_conversation_id IS NULL AND source_message_id IS NULL)
    OR
    (source_conversation_id IS NOT NULL AND source_message_id IS NOT NULL)
  ),
  CONSTRAINT product_work_items_linked_work_unique UNIQUE (linked_work_id)
);

CREATE INDEX IF NOT EXISTS product_work_items_workspace_idx
  ON product_work_items (tenant_id, workspace_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS product_work_items_assignee_idx
  ON product_work_items (tenant_id, workspace_id, assignee_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS product_work_items_source_idx
  ON product_work_items (tenant_id, source_conversation_id, source_message_id);

CREATE TABLE IF NOT EXISTS product_work_item_comments (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  work_item_id uuid NOT NULL REFERENCES product_work_items(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT product_work_item_comments_body_check CHECK (length(body) BETWEEN 1 AND 16384)
);

CREATE INDEX IF NOT EXISTS product_work_item_comments_item_idx
  ON product_work_item_comments (tenant_id, workspace_id, work_item_id, created_at, id);

CREATE TABLE IF NOT EXISTS product_work_boards (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  description text NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT product_work_boards_title_check CHECK (length(title) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS product_work_boards_workspace_idx
  ON product_work_boards (tenant_id, workspace_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS product_work_board_columns (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  board_id uuid NOT NULL REFERENCES product_work_boards(id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT product_work_board_columns_title_check CHECK (length(title) BETWEEN 1 AND 120),
  CONSTRAINT product_work_board_columns_position_check CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS product_work_board_columns_board_idx
  ON product_work_board_columns (tenant_id, workspace_id, board_id, position, created_at, id);

CREATE TABLE IF NOT EXISTS product_work_board_placements (
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  board_id uuid NOT NULL REFERENCES product_work_boards(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES product_work_board_columns(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES product_work_items(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (work_item_id),
  CONSTRAINT product_work_board_placements_position_check CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS product_work_board_placements_board_idx
  ON product_work_board_placements (tenant_id, workspace_id, board_id, column_id, position, created_at, work_item_id);

COMMIT;
