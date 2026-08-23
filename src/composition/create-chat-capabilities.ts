import type { Pool } from 'pg';

import { ExecutionRuntimeChatTurnProvider } from '../adapters/chat/execution-runtime-chat-turn-provider.js';
import { MockChatTurnProvider } from '../adapters/chat/mock-chat-turn-provider.js';
import { ListAgentHomeEntries } from '../application/agents/agent-home.js';
import { ChatBrainResolver } from '../application/chat/chat-brain-resolver.js';
import { ChatDeliveryReconciler } from '../application/chat/chat-delivery-reconciler.js';
import type { CreateAgentChatRuntimeSession } from '../application/runtime/create-agent-chat-runtime-session.js';
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

type EnabledDirectChatPlane = Exclude<
  AppConfig['directChatPlane'],
  'absent'
>;

interface CreateChatCapabilitiesDisabledOptions {
  readonly directChatPlane: 'absent';
}

interface CreateChatCapabilitiesEnabledOptions {
  readonly directChatPlane: EnabledDirectChatPlane;
  readonly database: Pool;
  readonly chatRuntime: {
    readonly sessionCreator: Pick<CreateAgentChatRuntimeSession, 'execute'>;
    readonly turnExecutor: Pick<ExecuteRuntimeTurn, 'execute'>;
  };
  readonly conversations: ConversationRepository;
  readonly chatDispatches: ChatDispatchRepository;
  readonly managedAgentDefinitions: Pick<
    ManagedAgentDefinitionRead,
    'findManagedDefinitionByTenant'
  >;
  readonly agentResolutionApi: AgentResolutionApi;
  readonly conversationWorkLinks: Pick<
    ConversationWorkLinkRepository,
    'findWorkIdsByOrigin'
  > | undefined;
  readonly logger: Logger;
  readonly conversationWorkEntitlements:
    | ConversationWorkEntitlementRepository
    | undefined;
  readonly workerId: string;
  readonly leaseMs: number;
}

export type CreateChatCapabilitiesOptions =
  | CreateChatCapabilitiesDisabledOptions
  | CreateChatCapabilitiesEnabledOptions;

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
          options.chatRuntime.sessionCreator,
          options.chatRuntime.turnExecutor,
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
      onError: ({ phase, errorName, error }) => {
        options.logger.log('error', 'chat.delivery_worker.failed', {
          phase,
          error_name: errorName,
          error_message: error instanceof Error ? error.message : undefined,
          error_stack: error instanceof Error ? error.stack : undefined,
          postgres_code:
            typeof (error as { code?: unknown })?.code === 'string'
              ? (error as { code: string }).code
              : undefined,
          worker_id: `${options.workerId}:chat`,
        });
      },
    },
  );

  return { chatWorker };
}
