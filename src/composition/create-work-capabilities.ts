import type { Pool } from 'pg';

import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import type { DefinitionReadApi } from '../application/ports/definition-read-api.js';
import type { ExecutionAdmission } from '../application/ports/execution-admission.js';
import type { ExecutionFactQuery } from '../application/ports/execution-fact-query.js';
import type { WorkDefinitionResolutionPort } from '../application/ports/work-definition-resolution.js';
import type { RuntimeCapabilities } from '../application/runtime/runtime-capabilities.js';
import { PostgresConversationWorkLinkRepository } from '../modules/work/conversation-work-link-repository.js';
import {
  createWorkModule,
  type WorkModule,
} from '../modules/work/work-module.js';
import {
  createWorkChatWakeWorker,
  PostgresWorkChatConversationAgentResolver,
  PostgresWorkChatWakeWorkSource,
  type WorkChatWakeWorker,
} from '../entrypoints/work-chat/worker.js';
import { PostgresWorkChatWakeStateRepository } from '../infrastructure/postgres/postgres-work-chat-wake-state-repository.js';
import type { ConversationWorkLinkRepository } from '../domain/chat/chat-work-origin-ref.js';
import type { Logger } from '../shared/observability/logger.js';

interface CreateWorkCapabilitiesBaseOptions {
  readonly database: Pool;
  readonly definitions: Pick<
    DefinitionReadApi,
    'findTeamDefinitionById' | 'findPublishedTeamVersionById'
  >;
  readonly definitionResolution?: WorkDefinitionResolutionPort;
  readonly conversations?: Pick<
    ConversationRepository,
    'appendMessage' | 'getChatRuntime'
  >;
  readonly runtimeCapabilities: RuntimeCapabilities;
  readonly productWorkEnabled: boolean;
  readonly directChatEnabled: boolean;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly logger: Logger;
}

export type CreateWorkCapabilitiesOptions =
  | (CreateWorkCapabilitiesBaseOptions & {
      readonly productWorkEnabled: false;
      readonly execution?: never;
      readonly executionFacts?: never;
    })
  | (CreateWorkCapabilitiesBaseOptions & {
      readonly productWorkEnabled: true;
      readonly execution: ExecutionAdmission;
      readonly executionFacts: ExecutionFactQuery;
    });

export interface WorkCapabilities {
  readonly workModule?: WorkModule;
  readonly workChatWorker?: WorkChatWakeWorker;
  readonly conversationWorkLinks?: ConversationWorkLinkRepository;
}

/** Creates the feature-gated Product Work capabilities and chat wake worker. */
export function createWorkCapabilities(
  options: CreateWorkCapabilitiesOptions,
): WorkCapabilities {
  if (!options.productWorkEnabled) return {};

  const workModule = createWorkModule({
    database: options.database,
    definitions: options.definitions,
    ...(options.definitionResolution
      ? { definitionResolution: options.definitionResolution }
      : {}),
    execution: options.execution,
    executionFacts: options.executionFacts,
    ...(options.directChatEnabled && options.conversations
      ? { conversations: options.conversations }
      : {}),
    runtimeCapabilities: options.runtimeCapabilities,
  });
  const conversationWorkLinks = new PostgresConversationWorkLinkRepository(
    options.database,
  );

  if (!options.directChatEnabled || !options.conversations) {
    return { workModule, conversationWorkLinks };
  }

  const workChatWorker = createWorkChatWakeWorker(
    {
      workSource: new PostgresWorkChatWakeWorkSource(options.database),
      state: new PostgresWorkChatWakeStateRepository(options.database),
      projection: workModule.createChatWorkCardProjection(),
      conversationWorkLinks,
      conversations: options.conversations,
      conversationAgentDefinitions:
        new PostgresWorkChatConversationAgentResolver(options.database),
    },
    {
      workerId: `${options.workerId}:work-chat`,
      leaseMs: options.leaseMs,
      onError: ({ phase, errorName }) => {
        options.logger.log('error', 'work_chat.wake_worker.failed', {
          phase,
          error_name: errorName,
          worker_id: `${options.workerId}:work-chat`,
        });
      },
    },
  );

  return { workModule, workChatWorker, conversationWorkLinks };
}
