import type { ConversationRepository } from '../ports/conversation-repository.js';
import type {
  ChatDispatch,
  ChatDispatchRepository,
} from '../ports/chat-dispatch-repository.js';
import type { ChatTurnProvider } from '../ports/chat-turn-provider.js';
import type { ConversationWorkEntitlementRepository } from '../ports/conversation-work-entitlement-repository.js';
import type { ConversationWorkLinkRepository } from '../../domain/chat/chat-work-origin-ref.js';
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { ChatBrainResolver } from './chat-brain-resolver.js';
import type { ConversationActorResolver } from './chat-turn-context.js';
import {
  ChatTurnRuntimeUnavailableError,
  ResolveChatTurnContext,
} from './resolve-chat-turn-context.js';
import { ResolveChatBrain } from './resolve-chat-brain.js';
import { BindChatCapabilities } from './bind-chat-capabilities.js';
import { ExecuteChatTurn } from './execute-chat-turn.js';
import { MaterializeChatReply } from './materialize-chat-reply.js';

/**
 * Thin orchestration seam:
 * ResolveChatTurnContext → ResolveChatBrain → BindChatCapabilities →
 * ExecuteChatTurn → MaterializeChatReply.
 *
 * Claim ownership belongs to ChatDeliveryWorker. The optional workerId path is
 * retained only for older focused tests/callers while they migrate.
 */
export class ChatDeliveryReconciler {
  readonly #resolveContext: ResolveChatTurnContext;
  readonly #resolveBrain: ResolveChatBrain;
  readonly #bindCapabilities: BindChatCapabilities;
  readonly #executeTurn: ExecuteChatTurn;
  readonly #materialize: MaterializeChatReply;

  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly dispatches: ChatDispatchRepository,
    provider: ChatTurnProvider,
    brainResolver: ChatBrainResolver,
    conversationWorkLinks:
      Pick<ConversationWorkLinkRepository, 'findWorkIdsByOrigin'> | undefined,
    private readonly logger?: Logger,
    private readonly now: () => Date = () => new Date(),
    workEntitlements?: ConversationWorkEntitlementRepository,
    extensions?: RuntimeExtensionBinder,
    actorResolver?: ConversationActorResolver,
  ) {
    this.#resolveContext = new ResolveChatTurnContext(
      conversations,
      dispatches,
      workEntitlements,
      actorResolver,
    );
    this.#resolveBrain = new ResolveChatBrain(brainResolver);
    this.#bindCapabilities = new BindChatCapabilities(extensions);
    this.#executeTurn = new ExecuteChatTurn(provider);
    this.#materialize = new MaterializeChatReply(
      conversations,
      dispatches,
      conversationWorkLinks,
    );
  }

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
    const context = await this.#resolveContext.execute(dispatch);
    if (!context) {
      // A materialized retry whose watermark already covers this activation can
      // be safely acknowledged without executing the provider again.
      if (workerId) await this.completeCompatibilityClaim(dispatch, workerId);
      return;
    }

    const brain = await this.#resolveBrain.execute(context);
    const extensions = await this.#bindCapabilities.execute(context, brain);
    const reply = await this.#executeTurn.execute(
      context,
      brain,
      extensions,
    );
    const materialized = await this.#materialize.execute(context, reply);

    if (workerId) await this.completeCompatibilityClaim(dispatch, workerId);

    this.logger?.log('info', 'chat.delivery.materialized', {
      tenant_id: dispatch.tenantId,
      agent_definition_id: dispatch.agentDefinitionId,
      conversation_id: dispatch.conversationId,
      dispatch_id: dispatch.id,
      through_sequence: dispatch.throughSequence,
      watermark: materialized.watermark,
      turn_mode: reply.mode ?? context.turn.modeHint,
      activation_causes: dispatch.causes?.length ?? 0,
    });
  }

  /**
   * Historical unclaimed seam: a missing runtime remains a no-op, never a
   * published activation. The production worker calls reconcile() and turns
   * this same condition into claim release/retry.
   */
  public async reconcileOne(dispatch: ChatDispatch): Promise<void> {
    try {
      await this.reconcile(dispatch);
    } catch (error) {
      if (error instanceof ChatTurnRuntimeUnavailableError) return;
      throw error;
    }
  }

  private async completeCompatibilityClaim(
    dispatch: ChatDispatch,
    workerId: string,
  ): Promise<void> {
    const published = await this.dispatches.completeClaim({
      id: dispatch.id,
      workerId,
      publishedAt: this.now().toISOString(),
    });
    if (!published) {
      this.logger?.log('warn', 'chat.delivery.lease_lost', {
        dispatch_id: dispatch.id,
        worker_id: workerId,
      });
    }
  }
}
