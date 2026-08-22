import type { ExecutionExtensionBinding } from '../ports/execution-plane.js';
import type {
  ChatTurnMessage,
  ChatTurnProvider,
} from '../ports/chat-turn-provider.js';
import type { ResolvedChatBrain } from './chat-brain-resolver.js';
import type { ResolvedChatTurnContext } from './resolve-chat-turn-context.js';

export interface ExecutedChatTurn {
  readonly body: string;
  readonly provider: string;
  readonly mode?: 'bootstrap' | 'delta' | 'recover';
}

/** Provider/runtime boundary only; contains no persistence side effects. */
export class ExecuteChatTurn {
  public constructor(private readonly provider: ChatTurnProvider) {}

  public execute(
    context: ResolvedChatTurnContext,
    brain: ResolvedChatBrain,
    extensions?: ExecutionExtensionBinding,
  ): Promise<ExecutedChatTurn> {
    return this.provider.runTurn({
      tenantId: context.dispatch.tenantId,
      agentDefinitionId: context.dispatch.agentDefinitionId,
      agentVersionId: context.runtime.activeAgentVersionId,
      conversationId: context.dispatch.conversationId,
      triggerMessageId: context.triggerMessage.id,
      brain,
      messages: context.messages.map(projectMessage),
      recoveryMessages: context.recoveryMessages.map(projectMessage),
      turn: context.turn,
      ...(extensions ? { extensions } : {}),
    });
  }
}

function projectMessage(
  message: import('../../domain/chat/chat-message.js').ChatMessage,
): ChatTurnMessage {
  return Object.freeze({
    messageId: message.id,
    sequence: message.sequence,
    authorType: message.authorType,
    authorId: message.authorId,
    body: message.body,
    workRef: message.workRef,
    deliveryId: message.deliveryId ?? null,
  });
}
