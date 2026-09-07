import type { WorkspaceMembershipRepository } from '../../application/ports/workspace-membership-repository.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

export class PostgresWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  public constructor(private readonly db: Queryable) {}

  public async ensureMember(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    // The workspace lookup is part of the write: membership can only be
    // granted into a workspace that already exists inside the caller's tenant.
    await this.db.query(
      `INSERT INTO workspace_members
         (workspace_id,tenant_id,principal_type,principal_id,created_at,updated_at)
       SELECT w.id,w.tenant_id,$3,$4,$5,$5
         FROM workspaces w
        WHERE w.id=$2 AND w.tenant_id=$1
       ON CONFLICT (workspace_id,tenant_id,principal_type,principal_id)
         DO NOTHING`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        now,
      ],
    );
  }
}
