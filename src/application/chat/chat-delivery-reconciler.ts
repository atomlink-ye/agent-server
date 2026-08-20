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
      await this.reconcile(dispatch);
      processed += 1;
    }
    return processed;
  }

  public async reconcile(
    dispatch: ChatDispatch,
    workerId?: string,
  ): Promise<void> {
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
      instructions: '',
      capabilitySummary: {},
      agentHome: {},
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

    const publishedAt = this.now().toISOString();
    if (workerId) {
      const published = await this.dispatches.completeClaim({
        id: dispatch.id,
        workerId,
        publishedAt,
      });
      if (!published) {
        this.logger?.log('warn', 'chat.delivery.lease_lost', {
          dispatch_id: dispatch.id,
          worker_id: workerId,
        });
        return;
      }
    } else {
      await this.dispatches.markPublished(dispatch.id, publishedAt);
    }

    this.logger?.log('info', 'chat.delivery.materialized', {
      tenant_id: dispatch.tenantId,
      agent_definition_id: dispatch.agentDefinitionId,
      conversation_id: dispatch.conversationId,
      dispatch_id: dispatch.id,
    });
  }

  // Retained for the existing focused test seam; leased workers use reconcile.
  private async reconcileOne(dispatch: ChatDispatch): Promise<void> {
    return this.reconcile(dispatch);
  }
}
