import type { ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import { ChatActivationPlanner } from './chat-activation-planner.js';

export async function enqueueChatDispatchForMessage(
  dispatches: ChatDispatchRepository,
  input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly agentDefinitionId: string;
    readonly lastReadSequence: number;
    readonly latestMessageSequence: number;
    readonly latestMessageAuthorType: 'principal' | 'agent_definition';
  },
): Promise<boolean> {
  const planner = new ChatActivationPlanner();
  const activation = planner.plan(input);
  if (!activation) return false;
  const cause = activation.causes[0];
  if (!cause) return false;
  const result = await dispatches.enqueue({
    tenantId: input.tenantId,
    agentDefinitionId: input.agentDefinitionId,
    conversationId: input.conversationId,
    throughSequence: cause.throughSequence,
    dedupeKey: activation.dedupeKey,
  });
  return result.enqueued;
}
