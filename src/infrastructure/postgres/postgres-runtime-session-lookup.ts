import type {
  RuntimeSession,
  RuntimeSessionLookup,
} from '../../application/ports/runtime-session-repository.js';

const PASEO_PLANE = 'paseo';

export class PostgresRuntimeSessionLookup implements RuntimeSessionLookup {
  public constructor(
    private readonly db: {
      query(
        sql: string,
        values?: readonly unknown[],
      ): Promise<{ rows?: readonly any[] }>;
    },
  ) {}

  public async findById(id: string): Promise<RuntimeSession | null> {
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id,
              sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.id=$1`,
      [id],
    );
    return result.rows?.[0] ? mapRuntimeSession(result.rows[0]) : null;
  }

  public async findByExecutionSessionBinding(
    binding: Parameters<RuntimeSessionLookup['findByExecutionSessionBinding']>[0],
  ): Promise<RuntimeSession | null> {
    if (binding.plane !== 'paseo') return null;
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id,
              sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.provider_agent_id=$1
       ORDER BY rs.created_at DESC
       LIMIT 2`,
      [binding.externalSessionId],
    );
    if ((result.rows?.length ?? 0) > 1)
      throw new Error('Execution session binding resolves to multiple RuntimeSessions.');
    return result.rows?.[0] ? mapRuntimeSession(result.rows[0]) : null;
  }

  public async findByExecutionSessionBinding(
    binding: Parameters<RuntimeSessionLookup['findByExecutionSessionBinding']>[0],
  ): Promise<RuntimeSession | null> {
    if (binding.plane !== 'paseo') return null;
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id,
              sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.provider_agent_id=$1
       ORDER BY rs.created_at DESC
       LIMIT 2`,
      [binding.externalSessionId],
    );
    if ((result.rows?.length ?? 0) > 1)
      throw new Error('Execution session binding resolves to multiple RuntimeSessions.');
    return result.rows?.[0] ? mapRuntimeSession(result.rows[0]) : null;
  }

  public async findByExecutionSessionBinding(
    binding: Parameters<RuntimeSessionLookup['findByExecutionSessionBinding']>[0],
  ): Promise<RuntimeSession | null> {
    if (binding.plane !== 'paseo') return null;
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id,
              sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.provider_agent_id=$1
       ORDER BY rs.created_at DESC
       LIMIT 2`,
      [binding.externalSessionId],
    );
    if ((result.rows?.length ?? 0) > 1)
      throw new Error('Execution session binding resolves to multiple RuntimeSessions.');
    return result.rows?.[0] ? mapRuntimeSession(result.rows[0]) : null;
  }

  public async findByExecutionSessionBinding(
    binding: Parameters<RuntimeSessionLookup['findByExecutionSessionBinding']>[0],
  ): Promise<RuntimeSession | null> {
    if (binding.plane !== 'paseo') return null;
    const result = await this.db.query(
      `SELECT rs.*, sls.workspace_id, sls.agent_version_id,
              sls.environment_version_id, sls.resolved_skills, sls.tool_refs
       FROM runtime_sessions rs
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       WHERE rs.provider_agent_id=$1
       ORDER BY rs.created_at DESC
       LIMIT 2`,
      [binding.externalSessionId],
    );
    if ((result.rows?.length ?? 0) > 1)
      throw new Error('Execution session binding resolves to multiple RuntimeSessions.');
    return result.rows?.[0] ? mapRuntimeSession(result.rows[0]) : null;
  }
}

function mapRuntimeSession(row: any): RuntimeSession {
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
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
