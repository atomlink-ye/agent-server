import type { ChatMessage } from '../../domain/chat/chat-message.js';
import type { ConversationWorkLinkRepository } from '../../domain/chat/chat-work-origin-ref.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import type { ExecutedChatTurn } from './execute-chat-turn.js';
import type { ResolvedChatTurnContext } from './resolve-chat-turn-context.js';

export interface MaterializedChatReply {
  readonly message: ChatMessage;
  readonly watermark: number;
}

/**
 * Durable reply boundary. The watermark moves only after appendMessage has
 * either inserted or idempotently reloaded the activation's reply.
 */
export class MaterializeChatReply {
  public constructor(
    private readonly conversations: Pick<ConversationRepository, 'appendMessage'>,
    private readonly watermarks: Pick<
      ChatDispatchRepository,
      'advanceRuntimeWatermark'
    >,
    private readonly conversationWorkLinks?: Pick<
      ConversationWorkLinkRepository,
      'findWorkIdsByOrigin'
    >,
  ) {}

  public async execute(
    context: ResolvedChatTurnContext,
    reply: ExecutedChatTurn,
  ): Promise<MaterializedChatReply> {
    const workRef = await this.resolveWorkRef(context);
    const message = await this.conversations.appendMessage({
      author: {
        type: 'agent_definition',
        tenantId: context.dispatch.tenantId,
        conversationId: context.dispatch.conversationId,
        agentDefinitionId: context.dispatch.agentDefinitionId,
        agentVersionId: context.runtime.activeAgentVersionId,
        runtimeEpoch: context.runtime.epoch,
        provider: reply.provider,
        turnMetadata: {
          kind: 'chat_activation_reply',
          dispatchId: context.dispatch.id,
          mode: reply.mode ?? context.turn.modeHint,
          throughSequence: context.dispatch.throughSequence,
        },
      },
      body: reply.body,
      workRef,
      deliveryId: `chat-reply:${context.dispatch.id}`,
    });

    const watermark = await this.watermarks.advanceRuntimeWatermark({
      agentChatRuntimeId: context.runtime.id,
      runtimeEpoch: context.runtime.epoch,
      tenantId: context.dispatch.tenantId,
      conversationId: context.dispatch.conversationId,
      throughSequence: context.dispatch.throughSequence,
    });
    return { message, watermark };
  }

  private async resolveWorkRef(
    context: ResolvedChatTurnContext,
  ): Promise<string | null> {
    const wakeRef = context.dispatch.causes
      .filter((cause) => cause.type === 'work_wake')
      .at(-1);
    if (wakeRef?.type === 'work_wake') return wakeRef.workRef;
    if (context.triggerMessage.workRef) return context.triggerMessage.workRef;
    if (!this.conversationWorkLinks) return null;
    const workIds = await this.conversationWorkLinks.findWorkIdsByOrigin({
      tenantId: context.dispatch.tenantId,
      conversationId: context.dispatch.conversationId,
      triggerMessageId: context.triggerMessage.id,
    });
    return workIds.length === 1 ? workIds[0]! : null;
  }
}
