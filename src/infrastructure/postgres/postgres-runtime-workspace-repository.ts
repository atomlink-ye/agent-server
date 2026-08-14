import type {
  RuntimeWorkspace,
  RuntimeWorkspaceRepository,
  RuntimeWorkspaceScope,
} from '../../application/ports/runtime-workspace-repository.js';
import { runtimeWorkspaceIdentity } from '../../application/ports/runtime-workspace-repository.js';

const PASEO_PLANE = 'paseo';

/**
 * First-round compatibility mapping. The existing schema stores the Paseo
 * workspace id on runtime_sessions; this repository exposes the concept as a
 * workspace-owned neutral binding without a DB migration.
 */
export class PostgresRuntimeWorkspaceRepository
  implements RuntimeWorkspaceRepository
{
  public constructor(
    private readonly db: {
      query(
        sql: string,
        values?: readonly unknown[],
      ): Promise<{ rows?: readonly any[] }>;
    },
  ) {}

  public async findForProductSession(input: {
    readonly productSessionId: string;
    readonly tenantId: string;
    readonly productWorkspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<RuntimeWorkspace> {
    const result = await this.db.query(
      `SELECT DISTINCT rs.paseo_workspace_id
       FROM runtime_sessions rs
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.scope_kind='product_session'
         AND rs.product_session_id=$1
         AND rs.tenant_id=$2
         AND sls.workspace_id=$3
         AND rs.principal_type=$4
         AND rs.principal_id=$5
         AND rs.paseo_workspace_id IS NOT NULL
       ORDER BY rs.paseo_workspace_id`,
      [
        input.productSessionId,
        input.tenantId,
        input.productWorkspaceId,
        input.principalType,
        input.principalId,
      ],
    );
    return this.#workspace(
      { kind: 'product_session', id: input.productSessionId },
      input.productWorkspaceId,
      result.rows ?? [],
    );
  }

  public async findForTeamRun(input: {
    readonly teamRunId: string;
    readonly tenantId: string;
    readonly productWorkspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<RuntimeWorkspace> {
    const result = await this.db.query(
      `SELECT DISTINCT rs.paseo_workspace_id
       FROM runtime_sessions rs
       JOIN team_member_runs tmr ON tmr.id=rs.scope_id
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.scope_kind='team_member'
         AND tmr.team_run_id=$1
         AND rs.tenant_id=$2
         AND tmr.tenant_id=$2
         AND sls.workspace_id=$3
         AND tmr.workspace_id=$3
         AND rs.principal_type=$4
         AND tmr.principal_type=$4
         AND rs.principal_id=$5
         AND tmr.principal_id=$5
         AND rs.paseo_workspace_id IS NOT NULL
       ORDER BY rs.paseo_workspace_id`,
      [
        input.teamRunId,
        input.tenantId,
        input.productWorkspaceId,
        input.principalType,
        input.principalId,
      ],
    );
    return this.#workspace(
      { kind: 'team_run', id: input.teamRunId },
      input.productWorkspaceId,
      result.rows ?? [],
    );
  }

  #workspace(
    scope: RuntimeWorkspaceScope,
    productWorkspaceId: string,
    rows: readonly any[],
  ): RuntimeWorkspace {
    const ids = rows.map((row) => row.paseo_workspace_id as string);
    if (ids.length > 1)
      throw new Error('Runtime workspace binding conflict.');
    return {
      id: runtimeWorkspaceIdentity(scope),
      scope,
      productWorkspaceId,
      binding: ids[0]
        ? { plane: PASEO_PLANE, externalWorkspaceId: ids[0] }
        : null,
    };
  }
}
