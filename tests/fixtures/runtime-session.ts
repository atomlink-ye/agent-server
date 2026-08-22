import type {
  RuntimeSession,
  RuntimeSessionRepository,
} from '../../src/application/ports/runtime-session-repository.js';

export function makeRuntimeSession(
  overrides: Partial<RuntimeSession> = {},
): RuntimeSession {
  const now = '2026-08-22T00:00:00.000Z';
  return {
    id: 'runtime-session-1',
    scope: { kind: 'product_session', productSessionId: 'product-session-1' },
    scopeKind: 'product_session',
    scopeId: 'product-session-1',
    productSessionId: 'product-session-1',
    taskId: null,
    launchSnapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    agentVersionId: 'agent-version-1',
    environmentVersionId: 'environment-version-1',
    resolvedSkills: [],
    toolRefs: [],
    desiredRevision: 1,
    desiredSpecDigest: null,
    status: 'pending',
    currentGeneration: null,
    workspaceBinding: null,
    sessionBinding: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export class FakeRuntimeSessionRepository implements RuntimeSessionRepository {
  public readonly sessions: RuntimeSession[] = [];

  private find(id: string): RuntimeSession {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Runtime session not found: ${id}`);
    return session;
  }

  private save(session: RuntimeSession): RuntimeSession {
    const index = this.sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) this.sessions[index] = session;
    else this.sessions.push(session);
    return session;
  }

  public async createOrGetForAgentChat(
    input: Parameters<RuntimeSessionRepository['createOrGetForAgentChat']>[0],
  ) {
    return this.save(
      makeRuntimeSession({
        id: input.agentChatRuntimeId,
        scope: {
          kind: 'agent_chat',
          agentChatRuntimeId: input.agentChatRuntimeId,
          runtimeEpoch: input.runtimeEpoch,
        },
        scopeKind: 'agent_chat',
        scopeId: `${input.agentChatRuntimeId}:${input.runtimeEpoch}`,
        productSessionId: null,
        environmentVersionId: null,
        workspaceId: input.workspaceId,
        agentVersionId: input.agentVersionId,
        resolvedSkills: input.resolvedSkills,
        toolRefs: input.toolRefs,
      }),
    );
  }
  public async findByAgentChat(
    input: Parameters<RuntimeSessionRepository['findByAgentChat']>[0],
  ) {
    return (
      this.sessions.find(
        (item) =>
          item.scope.kind === 'agent_chat' &&
          item.scope.agentChatRuntimeId === input.agentChatRuntimeId &&
          item.scope.runtimeEpoch === input.runtimeEpoch,
      ) ?? null
    );
  }
  public async createOrGetForTeamMember(
    input: Parameters<RuntimeSessionRepository['createOrGetForTeamMember']>[0],
  ) {
    return this.save(
      makeRuntimeSession({
        id: input.teamMemberRunId,
        scope: { kind: 'team_member', teamMemberRunId: input.teamMemberRunId },
        scopeKind: 'team_member',
        scopeId: input.teamMemberRunId,
        productSessionId: null,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
        agentVersionId: input.agentVersionId,
        environmentVersionId: input.environmentVersionId,
        resolvedSkills: input.resolvedSkills,
        toolRefs: input.toolRefs,
      }),
    );
  }
  public async findByTeamMember(
    input: Parameters<RuntimeSessionRepository['findByTeamMember']>[0],
  ) {
    return (
      this.sessions.find(
        (item) =>
          item.scope.kind === 'team_member' &&
          item.scope.teamMemberRunId === input.teamMemberRunId,
      ) ?? null
    );
  }
  public async createOrGetForProductSession(
    input: Parameters<
      RuntimeSessionRepository['createOrGetForProductSession']
    >[0],
  ) {
    return this.save(
      makeRuntimeSession({
        id: input.productSessionId,
        scope: {
          kind: 'product_session',
          productSessionId: input.productSessionId,
        },
        scopeId: input.productSessionId,
        productSessionId: input.productSessionId,
        workspaceId: input.workspaceId,
        agentVersionId: input.agentVersionId,
        environmentVersionId: input.environmentVersionId,
        resolvedSkills: input.resolvedSkills,
        toolRefs: input.toolRefs,
      }),
    );
  }
  public async createOrGetForTask(
    input: Parameters<RuntimeSessionRepository['createOrGetForTask']>[0],
  ) {
    return this.save(
      makeRuntimeSession({
        id: input.taskId,
        scope: { kind: 'task', taskId: input.taskId },
        scopeKind: 'task',
        scopeId: input.taskId,
        productSessionId: null,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
        agentVersionId: input.agentVersionId,
        environmentVersionId: input.environmentVersionId,
        resolvedSkills: input.resolvedSkills,
        toolRefs: input.toolRefs,
      }),
    );
  }
  public async findByProductSession(
    input: Parameters<RuntimeSessionRepository['findByProductSession']>[0],
  ) {
    return (
      this.sessions.find(
        (item) => item.productSessionId === input.productSessionId,
      ) ?? null
    );
  }
  public async findByTask(
    input: Parameters<RuntimeSessionRepository['findByTask']>[0],
  ) {
    return this.sessions.find((item) => item.taskId === input.taskId) ?? null;
  }
  public async reconcileDesiredSpec(
    input: Parameters<RuntimeSessionRepository['reconcileDesiredSpec']>[0],
  ) {
    const current = this.find(input.id);
    return this.save({
      ...current,
      desiredRevision:
        current.desiredSpecDigest === input.digest
          ? current.desiredRevision
          : current.desiredRevision + 1,
      desiredSpecDigest: input.digest,
      status: 'ready',
    });
  }
  public async bindExecution(
    input: Parameters<RuntimeSessionRepository['bindExecution']>[0],
  ) {
    const current = this.find(input.id);
    return this.save({
      ...current,
      workspaceBinding: input.workspaceBinding,
      sessionBinding: input.sessionBinding,
    });
  }
  public async replaceExecution(
    input: Parameters<RuntimeSessionRepository['replaceExecution']>[0],
  ) {
    return this.bindExecution(input);
  }
  public async markUnavailable(id: string) {
    return this.save({ ...this.find(id), status: 'unavailable' });
  }
}
