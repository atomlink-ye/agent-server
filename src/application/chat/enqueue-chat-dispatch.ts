import type { ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import type { Logger } from '../../shared/observability/logger.js';
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
    /** Optional observability for callers that need to correlate an activation. */
    readonly logger?: Logger;
    readonly workItemId?: string;
  },
): Promise<boolean> {
  const attributes = {
    tenant_id: input.tenantId,
    ...(input.workItemId === undefined
      ? {}
      : { work_item_id: input.workItemId }),
    conversation_id: input.conversationId,
    agent_definition_id: input.agentDefinitionId,
    latest_message_id: input.latestMessageId,
    latest_message_sequence: input.latestMessageSequence,
    last_read_sequence: input.lastReadSequence,
  };
  const planner = new ChatActivationPlanner();
  const activation = planner.plan(input);
  if (!activation) {
    input.logger?.log('warn', 'chat.dispatch.skipped', {
      ...attributes,
      reason:
        input.latestMessageAuthorType === 'agent_definition'
          ? 'agent_authored_message'
          : 'no_unread_messages',
    });
    return false;
  }
  const cause = activation.causes[0];
  if (!cause) {
    input.logger?.log('warn', 'chat.dispatch.skipped', {
      ...attributes,
      reason: 'no_activation_cause',
    });
    return false;
  }
  const debounceMs = input.debounceMs ?? CHAT_ACTIVATION_BURST_DEBOUNCE_MS;
  const durableCause =
    cause.type === 'unread_message' && input.latestMessageId
      ? { ...cause, messageId: input.latestMessageId }
      : cause;
  input.logger?.log('info', 'chat.dispatch.enqueue.requested', {
    ...attributes,
    reason: 'planner_admitted',
    debounce_ms: debounceMs,
  });
  const result = await dispatches.enqueue({
    tenantId: input.tenantId,
    agentDefinitionId: input.agentDefinitionId,
    conversationId: input.conversationId,
    throughSequence: cause.throughSequence,
    dedupeKey: activation.dedupeKey,
    cause: durableCause,
    priority: activation.priority,
    debounceMs,
  });
  input.logger?.log(
    result.enqueued ? 'info' : 'warn',
    'chat.dispatch.enqueue.result',
    {
      ...attributes,
      enqueued: result.enqueued,
      reason: result.enqueued ? 'dispatch_admitted' : 'duplicate',
      ...(result.dispatchId === undefined
        ? {}
        : { dispatch_id: result.dispatchId }),
    },
  );
  return result.enqueued;
}
