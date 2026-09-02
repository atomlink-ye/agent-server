import type { ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import { ChatActivationPlanner } from './chat-activation-planner.js';

/**
 * Fallback for callers that never pass `debounceMs`. Production callers
 * should pass `config.chat.activationBurstDebounceMs` (AGENT_SERVER_CHAT_ACTIVATION_BURST_DEBOUNCE_MS)
 * instead of relying on this constant, so operators can tune the window without a code change.
 */
export const CHAT_ACTIVATION_BURST_DEBOUNCE_MS = 2_000;

export async function enqueueChatDispatchForMessage(
  dispatches: Pick<ChatDispatchRepository, 'enqueue'>,
  input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly agentDefinitionId: string;
    readonly lastReadSequence: number;
    readonly latestMessageSequence: number;
    readonly latestMessageAuthorType: 'principal' | 'agent_definition';
    readonly latestMessageId?: string;
    /** Explicit zero is available to deterministic callers that bypass workers. */
    readonly debounceMs?: number;
  },
): Promise<boolean> {
  const planner = new ChatActivationPlanner();
  const activation = planner.plan(input);
  if (!activation) return false;
  const cause = activation.causes[0];
  if (!cause) return false;
  const durableCause =
    cause.type === 'unread_message' && input.latestMessageId
      ? { ...cause, messageId: input.latestMessageId }
      : cause;
  const result = await dispatches.enqueue({
    tenantId: input.tenantId,
    agentDefinitionId: input.agentDefinitionId,
    conversationId: input.conversationId,
    throughSequence: cause.throughSequence,
    dedupeKey: activation.dedupeKey,
    cause: durableCause,
    priority: activation.priority,
    debounceMs: input.debounceMs ?? CHAT_ACTIVATION_BURST_DEBOUNCE_MS,
  });
  return result.enqueued;
}
