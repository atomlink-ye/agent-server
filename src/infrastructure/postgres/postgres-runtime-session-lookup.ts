import type {
  RuntimeSession,
  RuntimeSessionGeneration,
  RuntimeSessionLookup,
  RuntimeSessionStatus,
} from '../../application/ports/runtime-session-repository.js';
import type { RuntimeScope } from '../../domain/runtime/runtime-invocation-context.js';

interface RuntimeSessionLookupDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

interface Row extends Record<string, unknown> {
  readonly id: string;
  readonly scope_kind: string;
  readonly scope_id: string | null;
  readonly agent_chat_runtime_id: string | null;
  readonly runtime_epoch: number | string | null;
  readonly product_session_id: string | null;
  readonly task_id: string | null;
  readonly launch_snapshot_id: string;
  readonly desired_revision: number | string;
  readonly desired_spec_digest: string | null;
  readonly runtime_status: RuntimeSessionStatus;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly workspace_id: string;
  readonly agent_version_id: string;
  readonly environment_version_id: string | null;
  readonly resolved_skills: unknown;
  readonly tool_refs: unknown;
  readonly generation_id: string | null;
  readonly generation_number: number | string | null;
  readonly generation_plane: string | null;
  readonly generation_workspace_id: string | null;
  readonly generation_session_id: string | null;
  readonly generation_applied_revision: number | string | null;
  readonly generation_applied_digest: string | null;
  readonly generation_endpoint_epoch: string | null;
  readonly generation_extension_grant_id: string | null;
  readonly generation_status:
    'active' | 'superseded' | 'unavailable' | 'closed' | null;
  readonly generation_created_at: string | Date | null;
  readonly generation_superseded_at: string | Date | null;
}

const SELECT = `SELECT
  rs.id, rs.scope_kind, rs.scope_id, rs.agent_chat_runtime_id, rs.runtime_epoch,
  rs.product_session_id, rs.task_id, rs.launch_snapshot_id,
  rs.desired_revision, rs.desired_spec_digest, rs.runtime_status,
  rs.created_at, rs.updated_at,
  sls.workspace_id, sls.agent_version_id, sls.environment_version_id,
  sls.resolved_skills, sls.tool_refs,
  rsg.id AS generation_id, rsg.generation AS generation_number,
  rsg.plane AS generation_plane,
  rsg.external_workspace_id AS generation_workspace_id,
  rsg.external_session_id AS generation_session_id,
  rsg.applied_revision AS generation_applied_revision,
  rsg.applied_spec_digest AS generation_applied_digest,
  rsg.endpoint_epoch AS generation_endpoint_epoch,
  rsg.extension_grant_id AS generation_extension_grant_id,
  rsg.status AS generation_status,
  rsg.created_at AS generation_created_at,
  rsg.superseded_at AS generation_superseded_at
FROM runtime_sessions rs
JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
LEFT JOIN runtime_session_generations rsg ON rsg.id=rs.current_generation_id`;

export class PostgresRuntimeSessionLookup implements RuntimeSessionLookup {
  public constructor(private readonly db: RuntimeSessionLookupDatabase) {}

  public async findById(id: string): Promise<RuntimeSession | null> {
    const result = await this.db.query<Row>(`${SELECT} WHERE rs.id=$1`, [id]);
    return result.rows?.[0] ? map(result.rows[0]) : null;
  }

  public async findByExecutionSessionBinding(
    binding: Parameters<
      RuntimeSessionLookup['findByExecutionSessionBinding']
    >[0],
  ): Promise<RuntimeSession | null> {
    const result = await this.db.query<Row>(
      `${SELECT}
       WHERE rsg.status='active' AND rsg.plane=$1 AND rsg.external_session_id=$2
       ORDER BY rsg.created_at DESC
       LIMIT 2`,
      [binding.plane, binding.externalSessionId],
    );
    if ((result.rows?.length ?? 0) > 1)
      throw new Error(
        'Execution session binding resolves to multiple active RuntimeSessions.',
      );
    return result.rows?.[0] ? map(result.rows[0]) : null;
  }
}

function map(row: Row): RuntimeSession {
  const scope = runtimeScope(row);
  const generation = mapGeneration(row);
  return Object.freeze({
    id: row.id,
    scope,
    scopeKind: scope.kind,
    workspaceId: row.workspace_id,
    scopeId: runtimeScopeId(scope),
    productSessionId: row.product_session_id,
    taskId: row.task_id,
    launchSnapshotId: row.launch_snapshot_id,
    agentVersionId: row.agent_version_id,
    environmentVersionId: row.environment_version_id,
    resolvedSkills: Object.freeze(skillRefs(row.resolved_skills)),
    toolRefs: Object.freeze(stringArray(row.tool_refs, 'tool_refs')),
    desiredRevision: positiveInteger(row.desired_revision, 'desired_revision'),
    desiredSpecDigest: row.desired_spec_digest,
    status: row.runtime_status,
    currentGeneration: generation,
    workspaceBinding: generation?.workspaceBinding ?? null,
    sessionBinding: generation?.sessionBinding ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapGeneration(row: Row): RuntimeSessionGeneration | null {
  if (!row.generation_id) return null;
  if (
    !row.generation_plane ||
    !row.generation_workspace_id ||
    !row.generation_session_id ||
    !row.generation_endpoint_epoch ||
    !row.generation_status ||
    !row.generation_created_at
  )
    throw new Error('Runtime session generation is incomplete.');
  return Object.freeze({
    id: row.generation_id,
    runtimeSessionId: row.id,
    generation: positiveInteger(row.generation_number, 'generation'),
    workspaceBinding: {
      plane: row.generation_plane,
      externalWorkspaceId: row.generation_workspace_id,
    },
    sessionBinding: {
      plane: row.generation_plane,
      externalSessionId: row.generation_session_id,
    },
    appliedRevision: positiveInteger(
      row.generation_applied_revision,
      'generation_applied_revision',
    ),
    appliedSpecDigest: row.generation_applied_digest,
    endpointEpoch: row.generation_endpoint_epoch,
    extensionGrantId: row.generation_extension_grant_id,
    status: row.generation_status,
    createdAt: iso(row.generation_created_at),
    supersededAt: row.generation_superseded_at
      ? iso(row.generation_superseded_at)
      : null,
  });
}

function runtimeScope(row: Row): RuntimeScope {
  switch (row.scope_kind) {
    case 'agent_chat': {
      if (!row.agent_chat_runtime_id)
        throw new Error('Agent chat RuntimeSession has no runtime id.');
      const runtimeEpoch = positiveInteger(row.runtime_epoch, 'runtime_epoch');
      return {
        kind: 'agent_chat',
        agentChatRuntimeId: row.agent_chat_runtime_id,
        runtimeEpoch,
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
      throw new Error(`Unsupported runtime scope ${row.scope_kind}.`);
  }
}

function runtimeScopeId(scope: RuntimeScope): string {
  switch (scope.kind) {
    case 'agent_chat':
      return scope.agentChatRuntimeId;
    case 'team_member':
      return scope.teamMemberRunId;
    case 'task':
      return scope.taskId;
    case 'product_session':
      return scope.productSessionId;
  }
}

function skillRefs(
  value: unknown,
): { readonly ref: string; readonly digest: string }[] {
  if (!Array.isArray(value))
    throw new Error('Runtime session skills are invalid.');
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as { ref?: unknown }).ref !== 'string' ||
      typeof (item as { digest?: unknown }).digest !== 'string'
    )
      throw new Error('Runtime session skill projection is invalid.');
    return {
      ref: (item as { ref: string }).ref,
      digest: (item as { digest: string }).digest,
    };
  });
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`Runtime session ${field} is invalid.`);
  return [...value] as string[];
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`Runtime session ${field} must be a positive integer.`);
  return parsed;
}

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error('Runtime session timestamp is invalid.');
  return parsed.toISOString();
}
