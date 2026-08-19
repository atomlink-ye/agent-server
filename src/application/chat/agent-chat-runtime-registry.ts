import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';

export async function ensureAgentChatRuntime(
  repo: ConversationRepository,
  input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly activeAgentVersionId: string;
  },
): Promise<AgentChatRuntime> {
  return repo.ensureChatRuntime(input);
}

export async function resolveAgentChatRuntime(
  repo: ConversationRepository,
  tenantId: string,
  agentDefinitionId: string,
  activeAgentVersionId: string,
): Promise<AgentChatRuntime> {
  return repo.ensureChatRuntime({
    tenantId,
    agentDefinitionId,
    activeAgentVersionId,
  });
}
