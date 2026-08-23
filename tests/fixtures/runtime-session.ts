import type {
  RuntimeScope,
  RuntimeSession,
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../src/domain/runtime/runtime-session.js';

/** Small current-shape RuntimeSession fixture shared by focused unit tests. */
export function makeRuntimeSession(
  overrides: Record<string, unknown> = {},
): RuntimeSession {
  const now = '2026-08-22T00:00:00.000Z';
  const legacyScope = overrides.scope as
    | { kind?: string; agentChatRuntimeId?: string; runtimeEpoch?: number }
    | undefined;
  const scope: RuntimeScope =
    legacyScope?.kind === 'agent_chat'
      ? {
          kind: 'agent_chat',
          id:
            legacyScope.agentChatRuntimeId ??
            String(overrides.id ?? 'runtime-session-1'),
          epoch: legacyScope.runtimeEpoch ?? 1,
        }
      : ((overrides.scope as RuntimeScope | undefined) ?? {
          kind: 'task',
          id: String(overrides.id ?? 'runtime-session-1'),
        });
  return {
    id: String(overrides.id ?? 'runtime-session-1') as RuntimeSessionId,
    owner: {
      tenantId: 'tenant-1',
      workspaceId: String(overrides.workspaceId ?? 'workspace-1'),
      principalType: 'service_account',
      principalId: 'agent-owner',
    },
    scope,
    desiredSpecRevision: (overrides.desiredSpecRevision ?? 1) as RuntimeSpecRevision,
    currentGenerationId: null,
    status: 'provisioning',
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
}
