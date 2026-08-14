import type {
  RuntimeSession,
  RuntimeSessionRepository,
} from '../../application/ports/runtime-session-repository.js';
import { randomUUID } from 'node:crypto';

const PASEO_PLANE = 'paseo';

export class PostgresRuntimeSessionRepository implements RuntimeSessionRepository {
  public constructor(
    private readonly db: {
      query(
        sql: string,
        values?: readonly unknown[],
      ): Promise<{ rows?: readonly any[] }>;
    },
  ) {}

  public async createOrGetForTeamMember(
    input: Parameters<
      NonNullable<RuntimeSessionRepository['createOrGetForTeamMember']>
    >[0],
  ): Promise<RuntimeSession> {
    const existing = await this.findByTeamMember(input);
    if (existing) return existing;
    const now = new Date().toISOString();
    const snapshotId = randomUUID();
    const runtimeId = randomUUID();
    await this.db.query(
      `INSERT INTO session_launch_snapshots(id,tenant_id,workspace_id,principal_type,principal_id,agent_version_id,environment_version_id,resolved_skills,tool_refs,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        snapshotId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.agentVersionId,
        input.environmentVersionId,
        JSON.stringify(input.resolvedSkills),
        JSON.stringify(input.toolRefs),
        now,
      ],
    );
    await this.db.query(
      `INSERT INTO runtime_sessions(id,tenant_id,principal_type,principal_id,scope_kind,scope_id,task_id,launch_snapshot_id,created_at,updated_at) VALUES($1,$2,$3,$4,'team_member',$5,$6,$7,$8,$8)`,
      [
        runtimeId,
        input.tenantId,
        input.principalType,
        input.principalId,
        input.teamMemberRunId,
        input.taskId,
        snapshotId,
        now,
      ],
    );
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id WHERE rs.scope_kind='team_member' AND rs.scope_id=$1 AND rs.tenant_id=$2 AND sls.workspace_id=$3 AND rs.principal_type=$4 AND rs.principal_id=$5`,
      [
        input.teamMemberRunId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
    if (!result.rows?.[0])
      throw new Error('Team member runtime session could not be created.');
    return map(result.rows[0]);
  }

  public async findByTeamMember(
    input: Parameters<
      NonNullable<RuntimeSessionRepository['findByTeamMember']>
    >[0],
  ): Promise<RuntimeSession | null> {
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id WHERE rs.scope_kind='team_member' AND rs.scope_id=$1 AND rs.tenant_id=$2 AND sls.workspace_id=$3 AND rs.principal_type=$4 AND rs.principal_id=$5`,
      [
        input.teamMemberRunId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
    return result.rows?.[0] ? map(result.rows[0]) : null;
  }

  public async findPaseoWorkspaceByTeamRun(
    input: Parameters<
      NonNullable<RuntimeSessionRepository['findPaseoWorkspaceByTeamRun']>
    >[0],
  ): Promise<string | null> {
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
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
    const workspaceIds = (result.rows ?? []).map(
      (row) => row.paseo_workspace_id as string,
    );
    if (workspaceIds.length > 1)
      throw new Error('TeamRun Paseo Workspace binding conflict.');
    return workspaceIds[0] ?? null;
  }

  public async createOrGetForProductSession(
    input: Parameters<
      RuntimeSessionRepository['createOrGetForProductSession']
    >[0],
  ): Promise<RuntimeSession> {
    const now = new Date().toISOString();
    const existing = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id WHERE rs.scope_kind='product_session' AND rs.product_session_id=$1 AND rs.tenant_id=$2 AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [
        input.productSessionId,
        input.tenantId,
        input.principalType,
        input.principalId,
      ],
    );
    if (existing.rows?.[0]) return map(existing.rows[0]);
    const snapshotId = randomUUID();
    const runtimeId = randomUUID();
    await this.db.query(
      `INSERT INTO session_launch_snapshots(id,tenant_id,workspace_id,principal_type,principal_id,agent_version_id,environment_version_id,resolved_skills,tool_refs,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [
        snapshotId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.agentVersionId,
        input.environmentVersionId,
        JSON.stringify(
          input.resolvedSkills.map(({ ref, digest }) => ({ ref, digest })),
        ),
        JSON.stringify(input.toolRefs),
        now,
      ],
    );
    await this.db.query(
      `INSERT INTO runtime_sessions(id,tenant_id,principal_type,principal_id,scope_kind,product_session_id,launch_snapshot_id,created_at,updated_at) VALUES($1,$2,$3,$4,'product_session',$5,$6,$7,$7) ON CONFLICT DO NOTHING`,
      [
        runtimeId,
        input.tenantId,
        input.principalType,
        input.principalId,
        input.productSessionId,
        snapshotId,
        now,
      ],
    );
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id WHERE rs.scope_kind='product_session' AND rs.product_session_id=$1 AND rs.tenant_id=$2 AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [
        input.productSessionId,
        input.tenantId,
        input.principalType,
        input.principalId,
      ],
    );
    if (!result.rows?.[0])
      throw new Error('Runtime session could not be created.');
    return map(result.rows[0]);
  }

  public async findByProductSession(
    input: Parameters<RuntimeSessionRepository['findByProductSession']>[0],
  ) {
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id WHERE rs.scope_kind='product_session' AND rs.product_session_id=$1 AND rs.tenant_id=$2 AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [
        input.productSessionId,
        input.tenantId,
        input.principalType,
        input.principalId,
      ],
    );
    return result.rows?.[0] ? map(result.rows[0]) : null;
  }

  public async createOrGetForTask(
    input: Parameters<RuntimeSessionRepository['createOrGetForTask']>[0],
  ): Promise<RuntimeSession> {
    const now = new Date().toISOString();
    const existing = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.scope_kind='task' AND rs.task_id=$1 AND rs.tenant_id=$2 AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [input.taskId, input.tenantId, input.principalType, input.principalId],
    );
    if (existing.rows?.[0]) return map(existing.rows[0]);

    const snapshotId = randomUUID();
    const runtimeId = randomUUID();
    await this.db.query(
      `INSERT INTO session_launch_snapshots(id,tenant_id,workspace_id,principal_type,principal_id,agent_version_id,environment_version_id,resolved_skills,tool_refs,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [
        snapshotId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.agentVersionId,
        input.environmentVersionId,
        JSON.stringify(
          input.resolvedSkills.map(({ ref, digest }) => ({ ref, digest })),
        ),
        JSON.stringify(input.toolRefs),
        now,
      ],
    );
    await this.db.query(
      `INSERT INTO runtime_sessions(id,tenant_id,principal_type,principal_id,scope_kind,task_id,launch_snapshot_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,'task',$5,$6,$7,$7) ON CONFLICT DO NOTHING`,
      [
        runtimeId,
        input.tenantId,
        input.principalType,
        input.principalId,
        input.taskId,
        snapshotId,
        now,
      ],
    );
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.scope_kind='task' AND rs.task_id=$1 AND rs.tenant_id=$2 AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [input.taskId, input.tenantId, input.principalType, input.principalId],
    );
    if (!result.rows?.[0])
      throw new Error('Task runtime session could not be created.');
    return map(result.rows[0]);
  }

  public async findByTask(
    input: Parameters<RuntimeSessionRepository['findByTask']>[0],
  ): Promise<RuntimeSession | null> {
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.scope_kind='task' AND rs.task_id=$1 AND rs.tenant_id=$2 AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [input.taskId, input.tenantId, input.principalType, input.principalId],
    );
    return result.rows?.[0] ? map(result.rows[0]) : null;
  }

  public async bindExecution(
    input: Parameters<RuntimeSessionRepository['bindExecution']>[0],
  ): Promise<RuntimeSession> {
    if (
      input.workspaceBinding.plane !== PASEO_PLANE ||
      input.sessionBinding.plane !== PASEO_PLANE
    )
      throw new Error('Unsupported execution plane binding.');
    return this.#bind({
      id: input.id,
      paseoWorkspaceId: input.workspaceBinding.externalWorkspaceId,
      providerAgentId: input.sessionBinding.externalSessionId,
    });
  }

  public async bindProvider(
    input: Parameters<RuntimeSessionRepository['bindProvider']>[0],
  ): Promise<RuntimeSession> {
    return this.#bind(input);
  }

  async #bind(input: {
    readonly id: string;
    readonly paseoWorkspaceId: string;
    readonly providerAgentId: string;
  }): Promise<RuntimeSession> {
    const result = await this.db.query(
      `UPDATE runtime_sessions SET paseo_workspace_id=$2, provider_agent_id=$3, updated_at=$4 WHERE id=$1 AND paseo_workspace_id IS NULL AND provider_agent_id IS NULL RETURNING *`,
      [
        input.id,
        input.paseoWorkspaceId,
        input.providerAgentId,
        new Date().toISOString(),
      ],
    );
    if (!result.rows?.[0]) {
      const existing = await this.db.query(
        `SELECT paseo_workspace_id, provider_agent_id FROM runtime_sessions WHERE id=$1`,
        [input.id],
      );
      const row = existing.rows?.[0];
      if (
        !row ||
        row.paseo_workspace_id !== input.paseoWorkspaceId ||
        row.provider_agent_id !== input.providerAgentId
      )
        throw new Error('Runtime session binding conflict.');
    }
    const joined = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id, sls.environment_version_id, sls.resolved_skills, sls.tool_refs FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id WHERE rs.id=$1`,
      [input.id],
    );
    if (!joined.rows?.[0])
      throw new Error('Runtime session snapshot could not be loaded.');
    return map(joined.rows[0]);
  }
}

function map(row: any): RuntimeSession {
  const paseoWorkspaceId = row.paseo_workspace_id ?? null;
  const providerAgentId = row.provider_agent_id ?? null;
  return {
    id: row.id,
    scopeKind: row.scope_kind,
    workspaceId: row.workspace_id,
    scopeId:
      row.scope_kind === 'task'
        ? row.task_id
        : row.scope_kind === 'team_member'
          ? row.scope_id
          : row.product_session_id,
    productSessionId: row.product_session_id ?? null,
    taskId: row.task_id ?? null,
    launchSnapshotId: row.launch_snapshot_id,
    agentVersionId: row.agent_version_id,
    environmentVersionId: row.environment_version_id,
    resolvedSkills: row.resolved_skills ?? [],
    toolRefs: row.tool_refs ?? [],
    workspaceBinding: paseoWorkspaceId
      ? { plane: PASEO_PLANE, externalWorkspaceId: paseoWorkspaceId }
      : null,
    sessionBinding: providerAgentId
      ? { plane: PASEO_PLANE, externalSessionId: providerAgentId }
      : null,
    paseoWorkspaceId,
    providerAgentId,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
