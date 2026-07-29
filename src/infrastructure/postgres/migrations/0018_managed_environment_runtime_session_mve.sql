BEGIN;
CREATE TABLE IF NOT EXISTS environment_definitions (id uuid PRIMARY KEY,tenant_id text NOT NULL,principal_type text NOT NULL,principal_id text NOT NULL,normalized_name text NOT NULL,display_name text NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(tenant_id,principal_type,principal_id,normalized_name),UNIQUE(id,tenant_id,principal_type,principal_id));
CREATE TABLE IF NOT EXISTS environment_versions (id uuid PRIMARY KEY,definition_id uuid NOT NULL,tenant_id text NOT NULL,principal_type text NOT NULL,principal_id text NOT NULL,status text NOT NULL CHECK(status IN ('draft','published')),display_name text NOT NULL,canonical_package jsonb NOT NULL,fingerprint text NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,published_at timestamptz NULL,UNIQUE(definition_id,fingerprint),UNIQUE(id,definition_id,tenant_id,principal_type,principal_id),UNIQUE(id,tenant_id,principal_type,principal_id),FOREIGN KEY(definition_id,tenant_id,principal_type,principal_id) REFERENCES environment_definitions(id,tenant_id,principal_type,principal_id));
CREATE TABLE IF NOT EXISTS environment_registry_idempotency (operation text NOT NULL CHECK(operation IN ('import','publish')),tenant_id text NOT NULL,principal_type text NOT NULL,principal_id text NOT NULL,idempotency_key text NOT NULL,request_fingerprint text NOT NULL,definition_id uuid NULL,version_id uuid NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,PRIMARY KEY(operation,tenant_id,principal_type,principal_id,idempotency_key));
ALTER TABLE product_sessions ADD COLUMN IF NOT EXISTS published_environment_version_id uuid NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_sessions_environment_version_owner_fk') THEN
    ALTER TABLE product_sessions ADD CONSTRAINT product_sessions_environment_version_owner_fk
      FOREIGN KEY (published_environment_version_id,tenant_id,principal_type,principal_id)
      REFERENCES environment_versions(id,tenant_id,principal_type,principal_id);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS session_launch_snapshots (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  agent_version_id uuid NOT NULL,
  environment_version_id uuid NOT NULL,
  resolved_skills jsonb NOT NULL,
  tool_refs jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(id,tenant_id,principal_type,principal_id),
  FOREIGN KEY(environment_version_id,tenant_id,principal_type,principal_id)
    REFERENCES environment_versions(id,tenant_id,principal_type,principal_id)
  ,FOREIGN KEY(agent_version_id,tenant_id,workspace_id,principal_type,principal_id)
    REFERENCES agent_versions(id,tenant_id,workspace_id,principal_type,principal_id)
);
CREATE TABLE IF NOT EXISTS runtime_sessions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  scope_kind text NOT NULL CHECK(scope_kind='product_session'),
  scope_id uuid NOT NULL REFERENCES product_sessions(id),
  launch_snapshot_id uuid NOT NULL,
  paseo_workspace_id text NULL,
  provider_agent_id text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(scope_kind,scope_id),
  UNIQUE(id,tenant_id,principal_type,principal_id),
  FOREIGN KEY(launch_snapshot_id,tenant_id,principal_type,principal_id)
    REFERENCES session_launch_snapshots(id,tenant_id,principal_type,principal_id)
);
CREATE OR REPLACE FUNCTION prevent_session_launch_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Session launch snapshots are immutable';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS session_launch_snapshots_immutable_before_update ON session_launch_snapshots;
CREATE TRIGGER session_launch_snapshots_immutable_before_update
  BEFORE UPDATE ON session_launch_snapshots FOR EACH ROW
  EXECUTE FUNCTION prevent_session_launch_snapshot_mutation();
CREATE OR REPLACE FUNCTION prevent_managed_environment_version_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status='published' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Published environment versions are immutable';
  END IF;
  IF OLD.status='draft' AND NEW.status='published'
     AND NEW.id=OLD.id AND NEW.definition_id=OLD.definition_id
     AND NEW.tenant_id=OLD.tenant_id AND NEW.principal_type=OLD.principal_type
     AND NEW.principal_id=OLD.principal_id AND NEW.display_name=OLD.display_name
     AND NEW.canonical_package=OLD.canonical_package AND NEW.fingerprint=OLD.fingerprint
     AND NEW.created_at=OLD.created_at THEN RETURN NEW;
  END IF;
  IF OLD.status='draft' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Environment versions are immutable except draft to published';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS environment_versions_immutable_before_update ON environment_versions;
CREATE TRIGGER environment_versions_immutable_before_update BEFORE UPDATE ON environment_versions FOR EACH ROW EXECUTE FUNCTION prevent_managed_environment_version_mutation();
COMMIT;
