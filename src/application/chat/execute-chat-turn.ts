import type { ExecutionExtensionBinding } from '../ports/runtime-extension-binding.js';
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
    const projectWithLabels = (
      message: import('../../domain/chat/chat-message.js').ChatMessage,
    ) => projectMessage(message, context.authorLabels);
    return this.provider.runTurn({
      tenantId: context.dispatch.tenantId,
      agentDefinitionId: context.dispatch.agentDefinitionId,
      agentVersionId: context.runtime.activeAgentVersionId,
      conversationId: context.dispatch.conversationId,
      triggerMessageId: context.triggerMessage.id,
      brain,
      messages: context.messages.map(projectWithLabels),
      recoveryMessages: context.recoveryMessages.map(projectWithLabels),
      turn: context.turn,
      ...(extensions ? { extensions } : {}),
    });
  }
}

function projectMessage(
  message: import('../../domain/chat/chat-message.js').ChatMessage,
  authorLabels: ReadonlyMap<string, string> | undefined,
): ChatTurnMessage {
  return Object.freeze({
    messageId: message.id,
    sequence: message.sequence,
    authorType: message.authorType,
    authorId: message.authorId,
    // A live-resolved workspace membership name takes precedence: it reflects
    // whoever this person is called *now*, and a rename must show up on the
    // very next turn. A WorkItem dispatch's actorLabel is the fallback -- it
    // is the durable message's own idea of who sent it, frozen at send time,
    // and the only name at all for an activation this dependency was not
    // wired for.
    authorLabel:
      authorLabels?.get(message.authorId) ??
      message.dispatch?.actorLabel ??
      null,
    body: message.body,
    workRef: message.workRef,
    deliveryId: message.deliveryId ?? null,
  });
}
