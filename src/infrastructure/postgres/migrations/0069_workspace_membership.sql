BEGIN;

-- A workspace has exactly one owner but more than one principal works inside
-- it. Work entitlements were keyed to *ownership*, which made a human
-- principal structurally unable to hold one: there is no workspaces row a
-- person owns, so the composite foreign key could never be satisfied and the
-- CHECK rejected the row outright. Membership is the relationship a person
-- actually has with a workspace, so entitlements key to that instead.
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  tenant_id text NOT NULL,
  principal_type text NOT NULL
    CHECK (principal_type IN ('service_account', 'user')),
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, tenant_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_principal_idx
  ON workspace_members (tenant_id, principal_type, principal_id);

-- Owning a workspace implies working in it. Enforced here rather than at each
-- call site so no future workspace can exist without its owner being able to
-- act in it.
CREATE OR REPLACE FUNCTION workspace_owner_joins_workspace()
RETURNS trigger AS $$
BEGIN
  IF NEW.principal_type IN ('service_account', 'user') THEN
    INSERT INTO workspace_members
      (workspace_id, tenant_id, principal_type, principal_id,
       created_at, updated_at)
    VALUES (NEW.id, NEW.tenant_id, NEW.principal_type, NEW.principal_id,
            NEW.created_at, NEW.updated_at)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspaces_owner_membership ON workspaces;
CREATE TRIGGER workspaces_owner_membership
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION workspace_owner_joins_workspace();

INSERT INTO workspace_members
  (workspace_id, tenant_id, principal_type, principal_id,
   created_at, updated_at)
SELECT w.id, w.tenant_id, w.principal_type, w.principal_id,
       w.created_at, w.updated_at
  FROM workspaces w
 WHERE w.principal_type IN ('service_account', 'user')
ON CONFLICT DO NOTHING;

ALTER TABLE conversation_work_entitlements
  DROP CONSTRAINT IF EXISTS
    conversation_work_entitlement_workspace_id_tenant_id_princ_fkey;
ALTER TABLE conversation_work_entitlements
  DROP CONSTRAINT IF EXISTS
    conversation_work_entitlements_workspace_id_tenant_id_princ_fkey;
ALTER TABLE conversation_work_entitlements
  DROP CONSTRAINT IF EXISTS conversation_work_entitlements_principal_type_check;
ALTER TABLE conversation_work_entitlements
  ADD CONSTRAINT conversation_work_entitlements_principal_type_check
    CHECK (principal_type IN ('service_account', 'user'));
ALTER TABLE conversation_work_entitlements
  DROP CONSTRAINT IF EXISTS conversation_work_entitlements_member_fkey;
ALTER TABLE conversation_work_entitlements
  ADD CONSTRAINT conversation_work_entitlements_member_fkey
    FOREIGN KEY (workspace_id, tenant_id, principal_type, principal_id)
    REFERENCES workspace_members
      (workspace_id, tenant_id, principal_type, principal_id);

COMMIT;
