export type AgentChatRuntimeStatus = 'available' | 'draining' | 'unavailable';

export interface AgentChatRuntime {
  /** UUID-backed runtime identity used as the chat extension scope. */
  readonly id: string;
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly activeAgentVersionId: string;
  readonly epoch: number;
  readonly status: AgentChatRuntimeStatus;
  readonly lastActiveAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Pure function: returns a new AgentChatRuntime with incremented epoch and updated version.
 * Throws if attempting to rotate to the same version (rotation must change the version).
 */
export function rotateChatRuntimeEpoch(
  current: AgentChatRuntime,
  newVersionId: string,
): AgentChatRuntime {
  if (newVersionId === current.activeAgentVersionId) {
    throw new Error(
      'Cannot rotate chat runtime epoch to the same agent version.',
    );
  }
  return Object.freeze({
    id: current.id,
    tenantId: current.tenantId,
    agentDefinitionId: current.agentDefinitionId,
    activeAgentVersionId: newVersionId,
    epoch: current.epoch + 1,
    status: current.status,
    lastActiveAt: current.lastActiveAt,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
}
