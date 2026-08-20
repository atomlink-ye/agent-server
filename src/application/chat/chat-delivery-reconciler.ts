import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { ChatDispatch, ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import type { ChatTurnProvider } from '../ports/chat-turn-provider.js';
import type { ConversationWorkEntitlementRepository } from '../ports/conversation-work-entitlement-repository.js';
import type { ConversationWorkLinkRepository } from '../../domain/chat/chat-work-origin-ref.js';
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../agents/built-in-skills.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { ChatBrainResolver } from './chat-brain-resolver.js';

export class ChatDeliveryReconciler {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly dispatches: ChatDispatchRepository,
    private readonly provider: ChatTurnProvider,
    private readonly brainResolver: ChatBrainResolver,
    private readonly conversationWorkLinks: Pick<
      ConversationWorkLinkRepository,
      'findWorkIdsByOrigin'
    >,
    private readonly logger?: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly workEntitlements?: ConversationWorkEntitlementRepository,
    private readonly extensions?: RuntimeExtensionBinder,
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
    const triggerMessage = messages.find(
      (message) =>
        message.sequence === dispatch.throughSequence &&
        message.tenantId === dispatch.tenantId &&
        message.conversationId === dispatch.conversationId,
    );
    if (!triggerMessage) {
      this.logger?.log('warn', 'chat.delivery.trigger_missing', {
        dispatch_id: dispatch.id,
        tenant_id: dispatch.tenantId,
        conversation_id: dispatch.conversationId,
        through_sequence: dispatch.throughSequence,
      });
      return;
    }

    const brain = await this.brainResolver.resolve({
      tenantId: dispatch.tenantId,
      agentDefinitionId: dispatch.agentDefinitionId,
      conversationId: dispatch.conversationId,
      runtime,
    });

    const entitlement = this.workEntitlements
      ? await this.workEntitlements.resolveForChatTurn({
          tenantId: dispatch.tenantId,
          conversationId: dispatch.conversationId,
          agentDefinitionId: dispatch.agentDefinitionId,
        })
      : null;
    const extensions = entitlement && this.extensions
      ? await this.extensions.bind({
          tenantId: entitlement.tenantId,
          principalType: entitlement.principalType,
          principalId: entitlement.principalId,
          workspaceId: entitlement.workspaceId,
          scopeId: runtime.id,
          chatContext: {
            conversationId: dispatch.conversationId,
            triggerMessageId: triggerMessage.id,
          },
          skills: [],
          toolRefs: [
            AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
            AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
          ],
          catalogTools: [
            AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
            AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
          ],
        })
      : undefined;

    const reply = await this.provider.runTurn({
      tenantId: dispatch.tenantId,
      agentDefinitionId: dispatch.agentDefinitionId,
      agentVersionId: runtime.activeAgentVersionId,
      conversationId: dispatch.conversationId,
      triggerMessageId: triggerMessage.id,
      brain,
      messages: messages.map((message) => ({
        authorType: message.authorType,
        authorId: message.authorId,
        body: message.body,
      })),
      ...(extensions ? { extensions } : {}),
    });

    const workIds = await this.conversationWorkLinks.findWorkIdsByOrigin({
      tenantId: dispatch.tenantId,
      conversationId: dispatch.conversationId,
      triggerMessageId: triggerMessage.id,
    });
    const workRef = workIds.length === 1 ? workIds[0]! : null;
    if (workIds.length > 1) {
      this.logger?.log('warn', 'chat.delivery.ambiguous_work_provenance', {
        dispatch_id: dispatch.id,
        tenant_id: dispatch.tenantId,
        agent_definition_id: dispatch.agentDefinitionId,
        conversation_id: dispatch.conversationId,
        trigger_message_id: triggerMessage.id,
        work_ids: workIds,
      });
    }

    await this.conversations.appendMessage({
      author: {
        type: 'agent_definition',
        tenantId: dispatch.tenantId,
        conversationId: dispatch.conversationId,
        agentDefinitionId: dispatch.agentDefinitionId,
        agentVersionId: runtime.activeAgentVersionId,
        runtimeEpoch: runtime.epoch,
        provider: reply.provider,
      },
      body: reply.body,
      workRef,
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
