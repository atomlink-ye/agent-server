import type { Pool } from 'pg';

import { ExecutionRuntimeChatTurnProvider } from '../adapters/chat/execution-runtime-chat-turn-provider.js';
import { MockChatTurnProvider } from '../adapters/chat/mock-chat-turn-provider.js';
import { ListAgentHomeEntries } from '../application/agents/agent-home.js';
import { ChatBrainResolver } from '../application/chat/chat-brain-resolver.js';
import { ChatDeliveryReconciler } from '../application/chat/chat-delivery-reconciler.js';
import type { EnsureDesiredRuntimeSpec } from '../application/ports/ensure-desired-runtime-spec.js';
import type { ExecuteRuntimeTurn } from '../application/runtime/execute-runtime-turn.js';
import type { AgentResolutionApi } from '../application/ports/agent-resolution-api.js';
import type { ManagedAgentDefinitionRead } from '../application/ports/agent-registry.js';
import type { ChatDispatchRepository } from '../application/ports/chat-dispatch-repository.js';
import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import type { ConversationWorkEntitlementRepository } from '../application/ports/conversation-work-entitlement-repository.js';
import type { ConversationWorkLinkRepository } from '../domain/chat/chat-work-origin-ref.js';
import { PostgresAgentHomeDefinitionSource } from '../infrastructure/postgres/postgres-agent-home-definition-source.js';
import { PostgresAgentHomeRepository } from '../infrastructure/postgres/postgres-agent-home-repository.js';
import { ChatDeliveryWorker } from '../entrypoints/chat/worker.js';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';

type EnabledDirectChatPlane = Exclude<AppConfig['directChatPlane'], 'absent'>;

interface CreateChatCapabilitiesDisabledOptions {
  readonly directChatPlane: 'absent';
}

interface CreateChatCapabilitiesEnabledOptions {
  readonly directChatPlane: EnabledDirectChatPlane;
  readonly database: Pool;
  readonly chatRuntime: {
    readonly desiredSpec: Pick<EnsureDesiredRuntimeSpec, 'execute'>;
    readonly configuration: {
      readonly provider: string;
      readonly model: string | null;
      readonly cwd: string;
    };
    readonly turnExecutor: Pick<ExecuteRuntimeTurn, 'execute'>;
  };
  readonly conversations: ConversationRepository;
  readonly chatDispatches: ChatDispatchRepository;
  readonly managedAgentDefinitions: Pick<
    ManagedAgentDefinitionRead,
    'findManagedDefinitionByTenant'
  >;
  readonly agentResolutionApi: AgentResolutionApi;
  readonly conversationWorkLinks:
    Pick<ConversationWorkLinkRepository, 'findWorkIdsByOrigin'> | undefined;
  readonly logger: Logger;
  readonly conversationWorkEntitlements:
    ConversationWorkEntitlementRepository | undefined;
  readonly workerId: string;
  readonly leaseMs: number;
}

export type CreateChatCapabilitiesOptions =
  CreateChatCapabilitiesDisabledOptions | CreateChatCapabilitiesEnabledOptions;

export interface ChatCapabilities {
  readonly chatWorker?: ChatDeliveryWorker;
}

/** Creates the feature-gated Direct Chat delivery worker. */
export function createChatCapabilities(
  options: CreateChatCapabilitiesOptions,
): ChatCapabilities {
  if (options.directChatPlane === 'absent') return {};

  const chatTurnProvider =
    options.directChatPlane === 'execution_runtime'
      ? new ExecutionRuntimeChatTurnProvider(
          options.chatRuntime.desiredSpec,
          options.chatRuntime.turnExecutor,
          options.chatRuntime.configuration,
        )
      : new MockChatTurnProvider();
  const chatBrainResolver = new ChatBrainResolver(
    options.managedAgentDefinitions,
    options.agentResolutionApi,
    new ListAgentHomeEntries(
      new PostgresAgentHomeRepository(options.database),
      new PostgresAgentHomeDefinitionSource(options.database),
    ),
  );
  const chatDeliveryReconciler = new ChatDeliveryReconciler(
    options.conversations,
    options.chatDispatches,
    chatTurnProvider,
    chatBrainResolver,
    options.conversationWorkLinks,
    options.logger,
    undefined,
    options.conversationWorkEntitlements,
  );
  const chatWorker = new ChatDeliveryWorker(
    options.chatDispatches,
    chatDeliveryReconciler,
    {
      workerId: `${options.workerId}:chat`,
      leaseMs: options.leaseMs,
      onError: ({
        phase,
        errorName,
        error,
        dispatchId,
        attemptCount,
        outcome,
        retryDelayMs,
      }) => {
        options.logger.log('error', 'chat.delivery_worker.failed', {
          phase,
          error_name: errorName,
          error_message: error instanceof Error ? error.message : undefined,
          error_stack: error instanceof Error ? error.stack : undefined,
          postgres_code:
            typeof (error as { code?: unknown })?.code === 'string'
              ? (error as { code: string }).code
              : undefined,
          dispatch_id: dispatchId,
          attempt_count: attemptCount,
          retry_outcome: outcome,
          retry_delay_ms: retryDelayMs,
          worker_id: `${options.workerId}:chat`,
        });
      },
      onDeadLetter: (event) => {
        options.logger.log('error', 'chat.delivery_worker.dead_letter', {
          dispatch_id: event.dispatchId,
          tenant_id: event.tenantId,
          conversation_id: event.conversationId,
          attempt_count: event.attemptCount,
          reason: event.reason,
          error_name: event.errorName,
          parked: event.parked,
          worker_id: `${options.workerId}:chat`,
        });
      },
      onCircuitState: (event) => {
        options.logger.log('warn', 'chat.delivery_worker.circuit_breaker', {
          state: event.state,
          cooldown_ms: event.cooldownMs,
          error_name: event.errorName,
          worker_id: `${options.workerId}:chat`,
        });
      },
    },
  );

  return { chatWorker };
}
