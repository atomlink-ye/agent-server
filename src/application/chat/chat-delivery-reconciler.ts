import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { ChatDispatch, ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import type { ChatTurnProvider } from '../ports/chat-turn-provider.js';
import type { Logger } from '../../shared/observability/logger.js';

export class ChatDeliveryReconciler {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly dispatches: ChatDispatchRepository,
    private readonly provider: ChatTurnProvider,
    private readonly logger?: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async reconcilePendingDispatches(limit = 50): Promise<number> {
    const pending = await this.dispatches.listPending(limit);
    let processed = 0;
    for (const dispatch of pending) {
      await this.reconcileOne(dispatch);
      processed += 1;
    }
    return processed;
  }

  private async reconcileOne(dispatch: ChatDispatch): Promise<void> {
    const runtime = await this.conversations.getChatRuntime({
      tenantId: dispatch.tenantId,
      agentDefinitionId: dispatch.agentDefinitionId,
    });
    if (!runtime) {
      this.logger?.log('warn', 'chat.delivery.runtime_missing', {
        tenant_id: dispatch.tenantId,
        agent_definition_id: dispatch.agentDefinitionId,
        conversation_id: dispatch.conversationId,
      });
      return;
    }

    const messages = await this.conversations.listMessages({
      tenantId: dispatch.tenantId,
      conversationId: dispatch.conversationId,
    });

    const reply = await this.provider.runTurn({
      tenantId: dispatch.tenantId,
      agentDefinitionId: dispatch.agentDefinitionId,
      agentVersionId: runtime.activeAgentVersionId,
      conversationId: dispatch.conversationId,
      messages: messages.map((message) => ({
        authorType: message.authorType,
        authorId: message.authorId,
        body: message.body,
      })),
    });

    await this.conversations.appendMessage({
      author: {
        type: 'agent_definition',
        tenantId: dispatch.tenantId,
        conversationId: dispatch.conversationId,
        agentDefinitionId: dispatch.agentDefinitionId,
        agentVersionId: runtime.activeAgentVersionId,
        runtimeEpoch: runtime.epoch,
      },
      body: reply.body,
    });

    await this.dispatches.markPublished(dispatch.id, this.now().toISOString());

    this.logger?.log('info', 'chat.delivery.materialized', {
      tenant_id: dispatch.tenantId,
      agent_definition_id: dispatch.agentDefinitionId,
      conversation_id: dispatch.conversationId,
      dispatch_id: dispatch.id,
    });
  }
}
