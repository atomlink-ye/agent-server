import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';
import type { ChatMessage } from '../../domain/chat/chat-message.js';
import { principalRef, type PrincipalRef } from '../../domain/tenancy/product-context.js';
import type { ConversationWorkEntitlement } from '../../domain/chat/conversation-work-entitlement.js';
import type { ChatDispatch } from '../ports/chat-dispatch-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { ConversationWorkEntitlementRepository } from '../ports/conversation-work-entitlement-repository.js';
import type { ChatTurnWindow } from '../ports/chat-turn-provider.js';
import type { ConversationActorResolver } from './chat-turn-context.js';

const DEFAULT_RECOVERY_MESSAGE_LIMIT = 50;

export interface ResolvedChatTurnContext {
  readonly dispatch: ChatDispatch;
  readonly runtime: AgentChatRuntime;
  readonly watermark: number;
  readonly turn: ChatTurnWindow;
  readonly triggerMessage: ChatMessage;
  readonly messages: readonly ChatMessage[];
  readonly recoveryMessages: readonly ChatMessage[];
  readonly actor?: PrincipalRef;
  readonly workEntitlement: ConversationWorkEntitlement | null;
}

/**
 * Resolves only durable product facts. It does not resolve Agent instructions,
 * bind runtime capabilities, execute a model, or materialize a reply.
 */
export class ResolveChatTurnContext {
  public constructor(
    private readonly conversations: Pick<
      ConversationRepository,
      'getChatRuntime' | 'listMessages' | 'findPrincipalMember'
    >,
    private readonly watermarks: Pick<
      import('../ports/chat-dispatch-repository.js').ChatDispatchRepository,
      'getRuntimeWatermark'
    >,
    private readonly workEntitlements?: ConversationWorkEntitlementRepository,
    private readonly actorResolver?: ConversationActorResolver,
    private readonly recoveryMessageLimit = DEFAULT_RECOVERY_MESSAGE_LIMIT,
  ) {}

  public async execute(
    dispatch: ChatDispatch,
  ): Promise<ResolvedChatTurnContext | null> {
    const runtime = await this.conversations.getChatRuntime({
      tenantId: dispatch.tenantId,
      agentDefinitionId: dispatch.agentDefinitionId,
    });
    if (!runtime || runtime.status !== 'available')
      throw new Error('chat_turn_runtime_unavailable');

    const watermark = await this.watermarks.getRuntimeWatermark({
      agentChatRuntimeId: runtime.id,
      runtimeEpoch: runtime.epoch,
      tenantId: dispatch.tenantId,
      conversationId: dispatch.conversationId,
    });
    // A retry may observe a reply that was materialized before the worker lost
    // its dispatch lease. Treat that as already complete and never re-run it.
    if (watermark >= dispatch.throughSequence) return null;

    const afterWatermark = await this.conversations.listMessages({
      tenantId: dispatch.tenantId,
      conversationId: dispatch.conversationId,
      afterSequence: watermark,
    });
    const activationWindow = afterWatermark.filter(
      (message) => message.sequence <= dispatch.throughSequence,
    );
    const messages = activationWindow.filter(isProviderDeltaEvent);
    const triggerMessage =
      activationWindow.find(
        (message) => message.sequence === dispatch.throughSequence,
      ) ?? activationWindow.at(-1);
    if (!triggerMessage)
      throw new Error('chat_turn_activation_has_no_durable_message');

    const recoveryAfter = Math.max(
      0,
      dispatch.throughSequence - boundedLimit(this.recoveryMessageLimit),
    );
    const recoveryMessages = (
      await this.conversations.listMessages({
        tenantId: dispatch.tenantId,
        conversationId: dispatch.conversationId,
        afterSequence: recoveryAfter,
      })
    ).filter((message) => message.sequence <= dispatch.throughSequence);

    const entitlement = this.workEntitlements
      ? await this.workEntitlements.resolveForChatTurn({
          tenantId: dispatch.tenantId,
          conversationId: dispatch.conversationId,
          agentDefinitionId: dispatch.agentDefinitionId,
        })
      : null;

    const latestPrincipal = [...activationWindow]
      .reverse()
      .find((message) => message.authorType === 'principal');
    const actor = latestPrincipal
      ? await this.resolvePrincipalActor(dispatch, latestPrincipal)
      : entitlement
        ? principalRef({
            principalType: entitlement.principalType,
            principalId: entitlement.principalId,
          })
        : undefined;

    if (latestPrincipal && entitlement && actor) {
      const entitled = principalRef({
        principalType: entitlement.principalType,
        principalId: entitlement.principalId,
      });
      if (actor.id !== entitled.id || actor.type !== entitled.type)
        throw new Error('chat_turn_actor_entitlement_mismatch');
    }

    return Object.freeze({
      dispatch,
      runtime,
      watermark,
      turn: Object.freeze({
        modeHint: watermark === 0 ? 'bootstrap' : 'delta',
        fromSequenceExclusive: watermark,
        throughSequence: dispatch.throughSequence,
      }),
      triggerMessage,
      messages: Object.freeze(messages),
      recoveryMessages: Object.freeze(recoveryMessages),
      ...(actor ? { actor } : {}),
      workEntitlement: entitlement,
    });
  }

  private async resolvePrincipalActor(
    dispatch: ChatDispatch,
    message: ChatMessage,
  ): Promise<PrincipalRef> {
    if (this.actorResolver) {
      const actor = await this.actorResolver.resolve({
        tenantId: dispatch.tenantId,
        conversationId: dispatch.conversationId,
        principalId: message.authorId,
      });
      if (!actor) throw new Error('chat_turn_actor_membership_missing');
      return actor;
    }
    if (this.conversations.findPrincipalMember) {
      const member = await this.conversations.findPrincipalMember({
        tenantId: dispatch.tenantId,
        conversationId: dispatch.conversationId,
        principalId: message.authorId,
      });
      if (!member?.memberPrincipalType)
        throw new Error('chat_turn_actor_membership_missing');
      return principalRef({
        principalType: member.memberPrincipalType,
        principalId: member.memberId,
      });
    }
    throw new Error('chat_turn_actor_resolver_unavailable');
  }
}

function isProviderDeltaEvent(message: ChatMessage): boolean {
  return !(
    message.authorType === 'agent_definition' &&
    typeof message.deliveryId === 'string' &&
    message.deliveryId.startsWith('chat-reply:')
  );
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RECOVERY_MESSAGE_LIMIT;
  return Math.max(1, Math.min(200, Math.trunc(value)));
}
