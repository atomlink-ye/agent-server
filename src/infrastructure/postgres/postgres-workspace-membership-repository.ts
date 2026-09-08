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
    readonly displayName?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    // The workspace lookup is part of the write: membership can only be
    // granted into a workspace that already exists inside the caller's tenant.
    await this.db.query(
      `INSERT INTO workspace_members
         (workspace_id,tenant_id,principal_type,principal_id,display_name,
          created_at,updated_at)
       SELECT w.id,w.tenant_id,$3,$4,$5,$6,$6
         FROM workspaces w
        WHERE w.id=$2 AND w.tenant_id=$1
       ON CONFLICT (workspace_id,tenant_id,principal_type,principal_id)
         DO NOTHING`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.displayName ?? null,
        now,
      ],
    );
  }

  public async findDisplayNames(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    if (input.principalIds.length === 0) return new Map();
    const result = await this.db.query<{
      principal_id: string;
      display_name: string;
    }>(
      `SELECT principal_id,display_name FROM workspace_members
        WHERE tenant_id=$1 AND workspace_id=$2 AND principal_id=ANY($3)
          AND display_name IS NOT NULL`,
      [input.tenantId, input.workspaceId, input.principalIds],
    );
    return new Map(
      (result.rows ?? []).map((row) => [row.principal_id, row.display_name]),
    );
  }

  public async setDisplayName(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly displayName: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.query(
      `UPDATE workspace_members SET display_name=$5,updated_at=$6
        WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type=$3
          AND principal_id=$4`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.displayName,
        now,
      ],
    );
  }
}
