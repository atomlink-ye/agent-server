import type {
  RuntimeSession,
  RuntimeSessionLookup,
} from '../../application/ports/runtime-session-repository.js';
import type { RuntimeScope } from '../../domain/runtime/runtime-invocation-context.js';

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
    binding: Parameters<
      RuntimeSessionLookup['findByExecutionSessionBinding']
    >[0],
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
      throw new Error(
        'Execution session binding resolves to multiple RuntimeSessions.',
      );
    return result.rows?.[0] ? mapRuntimeSession(result.rows[0]) : null;
  }
}

function mapRuntimeSession(row: any): RuntimeSession {
  const paseoWorkspaceId = row.paseo_workspace_id ?? null;
  const providerAgentId = row.provider_agent_id ?? null;
  const scope = runtimeScope(row);
  return {
    id: row.id,
    scope,
    scopeKind: scope.kind,
    workspaceId: row.workspace_id,
    scopeId: runtimeScopeId(scope),
    productSessionId: row.product_session_id ?? null,
    taskId: row.task_id ?? null,
    launchSnapshotId: row.launch_snapshot_id,
    agentVersionId: row.agent_version_id,
    environmentVersionId: row.environment_version_id ?? null,
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

function runtimeScope(row: any): RuntimeScope {
  switch (row.scope_kind) {
    case 'agent_chat': {
      if (!row.scope_id)
        throw new Error('Agent chat RuntimeSession has no scope id.');
      const parsed = parseAgentChatScopeId(row.scope_id);
      return {
        kind: 'agent_chat',
        agentChatRuntimeId: parsed.agentChatRuntimeId,
        runtimeEpoch: parsed.runtimeEpoch,
      };
    }
    case 'team_member':
      if (!row.scope_id)
        throw new Error('Team member RuntimeSession has no scope id.');
      return { kind: 'team_member', teamMemberRunId: row.scope_id };
    case 'task':
      if (!row.task_id) throw new Error('Task RuntimeSession has no task id.');
      return { kind: 'task', taskId: row.task_id };
    case 'product_session':
      if (!row.product_session_id)
        throw new Error('Product RuntimeSession has no product session id.');
      return {
        kind: 'product_session',
        productSessionId: row.product_session_id,
      };
    default:
      throw new Error(`Unsupported runtime scope ${String(row.scope_kind)}.`);
  }
}

function runtimeScopeId(scope: RuntimeScope): string {
  switch (scope.kind) {
    case 'agent_chat':
      return `${scope.agentChatRuntimeId}:${scope.runtimeEpoch}`;
    case 'team_member':
      return scope.teamMemberRunId;
    case 'task':
      return scope.taskId;
    case 'product_session':
      return scope.productSessionId;
  }
}

function parseAgentChatScopeId(scopeId: string): {
  readonly agentChatRuntimeId: string;
  readonly runtimeEpoch: number;
} {
  const separator = scopeId.lastIndexOf(':');
  if (separator <= 0)
    throw new Error('Agent chat RuntimeSession scope id is malformed.');
  const agentChatRuntimeId = scopeId.slice(0, separator);
  const runtimeEpoch = Number(scopeId.slice(separator + 1));
  if (!Number.isSafeInteger(runtimeEpoch) || runtimeEpoch <= 0)
    throw new Error('Agent chat RuntimeSession epoch is malformed.');
  return { agentChatRuntimeId, runtimeEpoch };
}
