import { randomUUID } from 'node:crypto';

import type {
  RuntimeSession,
  RuntimeSessionRepository,
} from '../../application/ports/runtime-session-repository.js';
import type { RuntimeScope } from '../../domain/runtime/runtime-invocation-context.js';

const PASEO_PLANE = 'paseo';
const SESSION_SELECT = `SELECT rs.*, sls.workspace_id, sls.agent_version_id,
  sls.environment_version_id, sls.resolved_skills, sls.tool_refs
  FROM runtime_sessions rs
  JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id`;

export class PostgresRuntimeSessionRepository
  implements RuntimeSessionRepository
{
  public constructor(
    private readonly db: {
      query(
        sql: string,
        values?: readonly unknown[],
      ): Promise<{ rows?: readonly any[] }>;
    },
  ) {}

  public async createOrGetForAgentChat(
    input: Parameters<
      NonNullable<RuntimeSessionRepository['createOrGetForAgentChat']>
    >[0],
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
    input: Parameters<
      NonNullable<RuntimeSessionRepository['findByAgentChat']>
    >[0],
  ): Promise<RuntimeSession | null> {
    assertPositiveRuntimeEpoch(input.runtimeEpoch);
    const result = await this.db.query(
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
    return result.rows?.[0] ? map(result.rows[0]) : null;
  }

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
       VALUES($1,$2,$3,$4,'team_member',$5,$6,$7,$8,$8)`,
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
    input: Parameters<
      NonNullable<RuntimeSessionRepository['findByTeamMember']>
    >[0],
  ): Promise<RuntimeSession | null> {
    const result = await this.db.query(
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
    return result.rows?.[0] ? map(result.rows[0]) : null;
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
    const result = await this.db.query(
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
    return result.rows?.[0] ? map(result.rows[0]) : null;
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
    const result = await this.db.query(
      `${SESSION_SELECT}
       WHERE rs.scope_kind='task' AND rs.task_id=$1 AND rs.tenant_id=$2
         AND rs.principal_type=$3 AND rs.principal_id=$4`,
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
    return this.bind({
      id: input.id,
      paseoWorkspaceId: input.workspaceBinding.externalWorkspaceId,
      providerAgentId: input.sessionBinding.externalSessionId,
    });
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

  private async bind(input: {
    readonly id: string;
    readonly paseoWorkspaceId: string;
    readonly providerAgentId: string;
  }): Promise<RuntimeSession> {
    const result = await this.db.query(
      `UPDATE runtime_sessions
       SET paseo_workspace_id=$2, provider_agent_id=$3, updated_at=$4
       WHERE id=$1 AND paseo_workspace_id IS NULL AND provider_agent_id IS NULL
       RETURNING *`,
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
    const joined = await this.db.query(`${SESSION_SELECT} WHERE rs.id=$1`, [
      input.id,
    ]);
    if (!joined.rows?.[0])
      throw new Error('Runtime session snapshot could not be loaded.');
    return map(joined.rows[0]);
  }
}

function map(row: any): RuntimeSession {
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

function assertPositiveRuntimeEpoch(runtimeEpoch: number): void {
  if (!Number.isSafeInteger(runtimeEpoch) || runtimeEpoch <= 0)
    throw new Error('Agent chat RuntimeSession requires a positive runtime epoch.');
}
