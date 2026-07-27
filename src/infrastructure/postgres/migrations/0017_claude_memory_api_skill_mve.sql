BEGIN;

CREATE TABLE IF NOT EXISTS memory_stores (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, tenant_id, principal_type, principal_id)
    REFERENCES workspaces (id, tenant_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY,
  memory_store_id uuid NOT NULL REFERENCES memory_stores (id),
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 512),
  current_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT memories_store_path_key UNIQUE (memory_store_id, path)
);

CREATE TABLE IF NOT EXISTS memory_versions (
  id uuid PRIMARY KEY,
  memory_id uuid NOT NULL REFERENCES memories (id),
  version integer NOT NULL CHECK (version > 0),
  content text NOT NULL CHECK (length(content) > 0),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_size_bytes integer NOT NULL
    CONSTRAINT memory_versions_content_size_ck
    CHECK (content_size_bytes > 0 AND content_size_bytes <= 65536),
  operation text NOT NULL CHECK (operation IN ('created', 'modified')),
  previous_version_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (memory_id, version),
  UNIQUE (id, memory_id),
  CONSTRAINT memory_versions_operation_ck CHECK (
    (operation = 'created' AND version = 1 AND previous_version_id IS NULL)
    OR (operation = 'modified' AND version > 1 AND previous_version_id IS NOT NULL)
  ),
  CONSTRAINT memory_versions_content_octets_ck
    CHECK (content_size_bytes = octet_length(content)),
  FOREIGN KEY (previous_version_id, memory_id)
    REFERENCES memory_versions (id, memory_id)
);

ALTER TABLE memories ALTER COLUMN current_version_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_versions_operation_ck' AND conrelid = 'memory_versions'::regclass) THEN
    ALTER TABLE memory_versions ADD CONSTRAINT memory_versions_operation_ck CHECK (
      (operation = 'created' AND version = 1 AND previous_version_id IS NULL)
      OR (operation = 'modified' AND version > 1 AND previous_version_id IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_versions_content_octets_ck' AND conrelid = 'memory_versions'::regclass) THEN
    ALTER TABLE memory_versions ADD CONSTRAINT memory_versions_content_octets_ck
      CHECK (content_size_bytes = octet_length(content));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memories_current_version_fk'
      AND conrelid = 'memories'::regclass
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_current_version_fk
      FOREIGN KEY (current_version_id, id)
      REFERENCES memory_versions (id, memory_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_memory_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'memory_versions are immutable';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_versions_immutable_trg'
      AND tgrelid = 'memory_versions'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER memory_versions_immutable_trg
      BEFORE UPDATE OR DELETE ON memory_versions
      FOR EACH ROW EXECUTE FUNCTION prevent_memory_version_mutation();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memory_stores_owner_idx
  ON memory_stores (tenant_id, workspace_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS memories_store_idx ON memories (memory_store_id);

COMMIT;
