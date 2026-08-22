import { randomUUID } from 'node:crypto';

import type {
  RuntimeSession,
  RuntimeSessionGeneration,
  RuntimeSessionRepository,
  RuntimeSessionStatus,
} from '../../application/ports/runtime-session-repository.js';
import type { RuntimeScope } from '../../domain/runtime/runtime-invocation-context.js';

const PASEO_PLANE = 'paseo';

interface RuntimeSessionDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[]; readonly rowCount?: number | null }>;
}

interface RuntimeSessionRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
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
  readonly current_generation_id: string | null;
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
    | 'active'
    | 'superseded'
    | 'unavailable'
    | 'closed'
    | null;
  readonly generation_created_at: string | Date | null;
  readonly generation_superseded_at: string | Date | null;
}

const SESSION_SELECT = `SELECT
  rs.id, rs.tenant_id, rs.principal_type, rs.principal_id,
  rs.scope_kind, rs.scope_id, rs.agent_chat_runtime_id, rs.runtime_epoch,
  rs.product_session_id, rs.task_id, rs.launch_snapshot_id,
  rs.desired_revision, rs.desired_spec_digest, rs.runtime_status,
  rs.current_generation_id, rs.created_at, rs.updated_at,
  sls.workspace_id, sls.agent_version_id, sls.environment_version_id,
  sls.resolved_skills, sls.tool_refs,
  rsg.id AS generation_id,
  rsg.generation AS generation_number,
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

export class PostgresRuntimeSessionRepository
  implements RuntimeSessionRepository
{
  public constructor(private readonly db: RuntimeSessionDatabase) {}

  public async createOrGetForAgentChat(
    input: Parameters<RuntimeSessionRepository['createOrGetForAgentChat']>[0],
  ): Promise<RuntimeSession> {
    assertPositiveRuntimeEpoch(input.runtimeEpoch);
    const existing = await this.findByAgentChat(input);
    if (existing) return existing;

    const now = new Date().toISOString();
    const snapshotId = randomUUID();
    const runtimeId = randomUUID();
    await this.insertSnapshot({
      id: snapshotId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      principalType: input.principalType,
      principalId: input.principalId,
      agentVersionId: input.agentVersionId,
      environmentVersionId: null,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      now,
    });
    await this.db.query(
      `INSERT INTO runtime_sessions
        (id,tenant_id,principal_type,principal_id,scope_kind,agent_chat_runtime_id,runtime_epoch,product_session_id,task_id,launch_snapshot_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,'agent_chat',$5,$6,NULL,NULL,$7,$8,$8)
       ON CONFLICT DO NOTHING`,
      [
        runtimeId,
        input.tenantId,
        input.principalType,
        input.principalId,
        input.agentChatRuntimeId,
        input.runtimeEpoch,
        snapshotId,
        now,
      ],
    );
    const created = await this.findByAgentChat(input);
    if (!created)
      throw new Error('Agent chat runtime session could not be created.');
    if (created.agentVersionId !== input.agentVersionId)
      throw new Error('Agent chat runtime session version does not match epoch.');
    return created;
  }

  public async findByAgentChat(
    input: Parameters<RuntimeSessionRepository['findByAgentChat']>[0],
  ): Promise<RuntimeSession | null> {
    assertPositiveRuntimeEpoch(input.runtimeEpoch);
    return this.findOne(
      `${SESSION_SELECT}
       WHERE rs.scope_kind='agent_chat'
         AND rs.agent_chat_runtime_id=$1 AND rs.runtime_epoch=$2
         AND rs.tenant_id=$3 AND sls.workspace_id=$4
         AND rs.principal_type=$5 AND rs.principal_id=$6`,
      [
        input.agentChatRuntimeId,
        input.runtimeEpoch,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
  }

  public async createOrGetForTeamMember(
    input: Parameters<RuntimeSessionRepository['createOrGetForTeamMember']>[0],
  ): Promise<RuntimeSession> {
    const existing = await this.findByTeamMember(input);
    if (existing) return existing;
    const now = new Date().toISOString();
    const snapshotId = randomUUID();
    const runtimeId = randomUUID();
    await this.insertSnapshot({
      id: snapshotId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      principalType: input.principalType,
      principalId: input.principalId,
      agentVersionId: input.agentVersionId,
      environmentVersionId: input.environmentVersionId,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      now,
    });
    await this.db.query(
      `INSERT INTO runtime_sessions
        (id,tenant_id,principal_type,principal_id,scope_kind,scope_id,task_id,launch_snapshot_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,'team_member',$5,$6,$7,$8,$8)
       ON CONFLICT DO NOTHING`,
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
    const created = await this.findByTeamMember(input);
    if (!created)
      throw new Error('Team member runtime session could not be created.');
    return created;
  }

  public async findByTeamMember(
    input: Parameters<RuntimeSessionRepository['findByTeamMember']>[0],
  ): Promise<RuntimeSession | null> {
    return this.findOne(
      `${SESSION_SELECT}
       WHERE rs.scope_kind='team_member' AND rs.scope_id=$1
         AND rs.tenant_id=$2 AND sls.workspace_id=$3
         AND rs.principal_type=$4 AND rs.principal_id=$5`,
      [
        input.teamMemberRunId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
  }

  public async createOrGetForProductSession(
    input: Parameters<
      RuntimeSessionRepository['createOrGetForProductSession']
    >[0],
  ): Promise<RuntimeSession> {
    const existing = await this.findByProductSession(input);
    if (existing) return existing;
    const now = new Date().toISOString();
    const snapshotId = randomUUID();
    const runtimeId = randomUUID();
    await this.insertSnapshot({
      id: snapshotId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      principalType: input.principalType,
      principalId: input.principalId,
      agentVersionId: input.agentVersionId,
      environmentVersionId: input.environmentVersionId,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      now,
    });
    await this.db.query(
      `INSERT INTO runtime_sessions
        (id,tenant_id,principal_type,principal_id,scope_kind,product_session_id,launch_snapshot_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,'product_session',$5,$6,$7,$7)
       ON CONFLICT DO NOTHING`,
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
    const created = await this.findByProductSession(input);
    if (!created) throw new Error('Runtime session could not be created.');
    return created;
  }

  public async findByProductSession(
    input: Parameters<RuntimeSessionRepository['findByProductSession']>[0],
  ): Promise<RuntimeSession | null> {
    return this.findOne(
      `${SESSION_SELECT}
       WHERE rs.scope_kind='product_session' AND rs.product_session_id=$1
         AND rs.tenant_id=$2 AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [
        input.productSessionId,
        input.tenantId,
        input.principalType,
        input.principalId,
      ],
    );
  }

  public async createOrGetForTask(
    input: Parameters<RuntimeSessionRepository['createOrGetForTask']>[0],
  ): Promise<RuntimeSession> {
    const existing = await this.findByTask(input);
    if (existing) return existing;
    const now = new Date().toISOString();
    const snapshotId = randomUUID();
    const runtimeId = randomUUID();
    await this.insertSnapshot({
      id: snapshotId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      principalType: input.principalType,
      principalId: input.principalId,
      agentVersionId: input.agentVersionId,
      environmentVersionId: input.environmentVersionId,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      now,
    });
    await this.db.query(
      `INSERT INTO runtime_sessions
        (id,tenant_id,principal_type,principal_id,scope_kind,task_id,launch_snapshot_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,'task',$5,$6,$7,$7)
       ON CONFLICT DO NOTHING`,
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
    const created = await this.findByTask(input);
    if (!created)
      throw new Error('Task runtime session could not be created.');
    return created;
  }

  public async findByTask(
    input: Parameters<RuntimeSessionRepository['findByTask']>[0],
  ): Promise<RuntimeSession | null> {
    return this.findOne(
      `${SESSION_SELECT}
       WHERE rs.scope_kind='task' AND rs.task_id=$1 AND rs.tenant_id=$2
         AND rs.principal_type=$3 AND rs.principal_id=$4`,
      [input.taskId, input.tenantId, input.principalType, input.principalId],
    );
  }

  public async reconcileDesiredSpec(
    input: Parameters<RuntimeSessionRepository['reconcileDesiredSpec']>[0],
  ): Promise<RuntimeSession> {
    const now = new Date().toISOString();
    await this.db.query(
      `UPDATE runtime_sessions
          SET desired_revision = CASE
                WHEN desired_spec_digest IS NULL OR desired_spec_digest=$2
                  THEN desired_revision
                ELSE desired_revision + 1
              END,
              desired_spec_digest=$2,
              runtime_status = CASE
                WHEN current_generation_id IS NULL THEN 'pending'
                WHEN desired_spec_digest IS NULL OR desired_spec_digest=$2
                  THEN runtime_status
                ELSE 'reconciling'
              END,
              updated_at=$3
        WHERE id=$1`,
      [input.id, input.digest, now],
    );
    return this.requireById(input.id, 'after desired-spec reconciliation');
  }

  public async bindExecution(
    input: Parameters<RuntimeSessionRepository['bindExecution']>[0],
  ): Promise<RuntimeSession> {
    assertExecutionBinding(input.workspaceBinding.plane, input.sessionBinding.plane);
    const generationId = randomUUID();
    const now = new Date().toISOString();
    const result = await this.db.query(
      `WITH inserted AS (
         INSERT INTO runtime_session_generations (
           id,runtime_session_id,generation,plane,external_workspace_id,
           external_session_id,applied_revision,applied_spec_digest,
           endpoint_epoch,extension_grant_id,status,created_at,superseded_at
         )
         SELECT $2, rs.id, 1, $3, $4, $5, $6, $7, $8, $9, 'active', $10, NULL
           FROM runtime_sessions rs
          WHERE rs.id=$1 AND rs.current_generation_id IS NULL
         RETURNING id
       )
       UPDATE runtime_sessions
          SET current_generation_id=(SELECT id FROM inserted),
              runtime_status='ready',
              paseo_workspace_id=$4,
              provider_agent_id=$5,
              updated_at=$10
        WHERE id=$1 AND current_generation_id IS NULL
          AND EXISTS (SELECT 1 FROM inserted)`,
      [
        input.id,
        generationId,
        input.sessionBinding.plane,
        input.workspaceBinding.externalWorkspaceId,
        input.sessionBinding.externalSessionId,
        input.appliedRevision,
        input.appliedSpecDigest,
        input.endpointEpoch,
        input.extensionGrantId ?? null,
        now,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      const existing = await this.requireById(input.id, 'after binding conflict');
      if (!sameGeneration(existing.currentGeneration, input))
        throw new Error('Runtime session binding conflict.');
      return existing;
    }
    return this.requireById(input.id, 'after initial execution binding');
  }

  public async replaceExecution(
    input: Parameters<RuntimeSessionRepository['replaceExecution']>[0],
  ): Promise<RuntimeSession> {
    assertExecutionBinding(input.workspaceBinding.plane, input.sessionBinding.plane);
    const generationId = randomUUID();
    const now = new Date().toISOString();
    const result = await this.db.query(
      `WITH current AS (
         SELECT rs.current_generation_id,
                COALESCE(MAX(rsg.generation),0) + 1 AS next_generation
           FROM runtime_sessions rs
           LEFT JOIN runtime_session_generations rsg
             ON rsg.runtime_session_id=rs.id
          WHERE rs.id=$1
          GROUP BY rs.current_generation_id
       ), superseded AS (
         UPDATE runtime_session_generations old
            SET status='superseded', superseded_at=$10
           FROM current
          WHERE old.id=current.current_generation_id
            AND old.status='active'
         RETURNING old.id
       ), inserted AS (
         INSERT INTO runtime_session_generations (
           id,runtime_session_id,generation,plane,external_workspace_id,
           external_session_id,applied_revision,applied_spec_digest,
           endpoint_epoch,extension_grant_id,status,created_at,superseded_at
         )
         SELECT $2,$1,current.next_generation,$3,$4,$5,$6,$7,$8,$9,
                'active',$10,NULL
           FROM current
         RETURNING id
       )
       UPDATE runtime_sessions
          SET current_generation_id=(SELECT id FROM inserted),
              runtime_status='ready',
              paseo_workspace_id=$4,
              provider_agent_id=$5,
              updated_at=$10
        WHERE id=$1 AND EXISTS (SELECT 1 FROM inserted)`,
      [
        input.id,
        generationId,
        input.sessionBinding.plane,
        input.workspaceBinding.externalWorkspaceId,
        input.sessionBinding.externalSessionId,
        input.appliedRevision,
        input.appliedSpecDigest,
        input.endpointEpoch,
        input.extensionGrantId ?? null,
        now,
      ],
    );
    if ((result.rowCount ?? 0) === 0)
      throw new Error('Runtime session replacement could not be committed.');
    return this.requireById(input.id, 'after execution replacement');
  }

  public async markUnavailable(id: string): Promise<RuntimeSession> {
    const now = new Date().toISOString();
    await this.db.query(
      `WITH marked AS (
         UPDATE runtime_session_generations
            SET status='unavailable'
          WHERE id=(SELECT current_generation_id FROM runtime_sessions WHERE id=$1)
            AND status='active'
         RETURNING id
       )
       UPDATE runtime_sessions
          SET runtime_status='unavailable', updated_at=$2
        WHERE id=$1`,
      [id, now],
    );
    return this.requireById(id, 'after unavailable transition');
  }

  private async insertSnapshot(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly agentVersionId: string;
    readonly environmentVersionId: string | null;
    readonly resolvedSkills: readonly {
      readonly ref: string;
      readonly digest: string;
    }[];
    readonly toolRefs: readonly string[];
    readonly now: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO session_launch_snapshots
        (id,tenant_id,workspace_id,principal_type,principal_id,agent_version_id,environment_version_id,resolved_skills,tool_refs,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING`,
      [
        input.id,
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
        input.now,
      ],
    );
  }

  private async findOne(
    sql: string,
    values: readonly unknown[],
  ): Promise<RuntimeSession | null> {
    const result = await this.db.query<RuntimeSessionRow>(sql, values);
    return result.rows?.[0] ? map(result.rows[0]) : null;
  }

  private async requireById(id: string, context: string): Promise<RuntimeSession> {
    const result = await this.findOne(`${SESSION_SELECT} WHERE rs.id=$1`, [id]);
    if (!result) throw new Error(`Runtime session could not be loaded ${context}.`);
    return result;
  }
}

function map(row: RuntimeSessionRow): RuntimeSession {
  const scope = runtimeScope(row);
  const currentGeneration = mapGeneration(row);
  return Object.freeze({
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
    resolvedSkills: Object.freeze(skillRefs(row.resolved_skills)),
    toolRefs: Object.freeze(stringArray(row.tool_refs, 'tool_refs')),
    desiredRevision: positiveInteger(row.desired_revision, 'desired_revision'),
    desiredSpecDigest: row.desired_spec_digest,
    status: row.runtime_status,
    currentGeneration,
    workspaceBinding: currentGeneration?.workspaceBinding ?? null,
    sessionBinding: currentGeneration?.sessionBinding ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapGeneration(
  row: RuntimeSessionRow,
): RuntimeSessionGeneration | null {
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

function runtimeScope(row: RuntimeSessionRow): RuntimeScope {
  switch (row.scope_kind) {
    case 'agent_chat': {
      if (!row.agent_chat_runtime_id)
        throw new Error('Agent chat RuntimeSession has no runtime id.');
      const runtimeEpoch = Number(row.runtime_epoch);
      assertPositiveRuntimeEpoch(runtimeEpoch);
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
      throw new Error(`Unsupported runtime scope ${String(row.scope_kind)}.`);
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

function sameGeneration(
  generation: RuntimeSessionGeneration | null,
  input: Parameters<RuntimeSessionRepository['bindExecution']>[0],
): boolean {
  return Boolean(
    generation &&
      generation.workspaceBinding.plane === input.workspaceBinding.plane &&
      generation.workspaceBinding.externalWorkspaceId ===
        input.workspaceBinding.externalWorkspaceId &&
      generation.sessionBinding.plane === input.sessionBinding.plane &&
      generation.sessionBinding.externalSessionId ===
        input.sessionBinding.externalSessionId &&
      generation.appliedRevision === input.appliedRevision &&
      generation.appliedSpecDigest === input.appliedSpecDigest &&
      generation.endpointEpoch === input.endpointEpoch &&
      generation.extensionGrantId === (input.extensionGrantId ?? null),
  );
}

function assertExecutionBinding(workspacePlane: string, sessionPlane: string): void {
  if (workspacePlane !== sessionPlane)
    throw new Error('Runtime workspace/session planes do not match.');
  if (!workspacePlane) throw new Error('Runtime execution plane is unavailable.');
}

function skillRefs(value: unknown): { readonly ref: string; readonly digest: string }[] {
  if (!Array.isArray(value)) throw new Error('Runtime session skills are invalid.');
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
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(`Runtime session ${field} must be a positive integer.`);
  return number;
}

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error('Runtime session timestamp is invalid.');
  return parsed.toISOString();
}

function assertPositiveRuntimeEpoch(runtimeEpoch: number): void {
  if (!Number.isSafeInteger(runtimeEpoch) || runtimeEpoch <= 0)
    throw new Error('Agent chat RuntimeSession requires a positive runtime epoch.');
}
