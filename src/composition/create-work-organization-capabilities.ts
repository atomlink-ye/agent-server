import type { Hono } from 'hono';
import type { Pool } from 'pg';

import { createManagedAgentMentionRoster } from '../adapters/work-organization/managed-agent-mention-roster.js';
import type { RuntimeToolContributor } from '../application/extensions/runtime-tool-catalog.js';
import type { ManagedAgentDefinitionRead } from '../application/ports/agent-registry.js';
import type { ChatDispatchRepository } from '../application/ports/chat-dispatch-repository.js';
import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import { wakeMentionedAgents } from '../application/work-organization/wake-mentioned-agents.js';
import { WorkOrganizationService } from '../application/work-organization/work-organization-service.js';
import type { ApiEnvironment } from '../entrypoints/api/http-types.js';
import { registerWorkOrganizationRoutes } from '../entrypoints/api/routes/work-organization.js';
import { registerWorkOrganizationMcpTools } from '../entrypoints/mcp/work-organization-mcp-tools.js';
import { PostgresConversationAgentIdentityResolver } from '../infrastructure/postgres/postgres-conversation-agent-identity-resolver.js';
import { PostgresWakeLoopGuardRepository } from '../infrastructure/postgres/postgres-wake-loop-guard-repository.js';
import { PostgresWorkOrganizationRepository } from '../infrastructure/postgres/postgres-work-organization-repository.js';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import type { WorkModule } from './create-work-capabilities.js';

export interface WorkOrganizationModule {
  readonly service: WorkOrganizationService;
  installHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
  readonly contributeRuntime: RuntimeToolContributor;
}

export interface CreateWorkOrganizationCapabilitiesOptions {
  readonly database: Pick<Pool, 'query'>;
  readonly work: Pick<WorkModule, 'identity' | 'projection'>;
  readonly conversations?: Pick<
    ConversationRepository,
    'getConversation' | 'listMessages'
  >;
  /**
   * Waking a mentioned Coworker needs the full conversation write path, not just
   * the read seam above: an @-mention posts a message and enqueues a dispatch.
   */
  readonly wake?: {
    readonly conversations: Pick<
      ConversationRepository,
      'findOrCreateDirect' | 'appendMessage' | 'getUnread' | 'getChatRuntime'
    >;
    readonly dispatches: Pick<ChatDispatchRepository, 'enqueue'>;
    readonly definitions: Pick<
      ManagedAgentDefinitionRead,
      'listManagedDefinitionsByTenant'
    >;
    /** Overrides the enqueue burst-debounce default; pass the configured value. */
    readonly debounceMs?: number;
  };
  readonly logger?: Logger;
}

/**
 * Product coordination sits above the existing Work execution plane. It owns
 * WorkItems/Boards, while formal Work identity/projection remain composed by
 * the canonical Work module behind its application-level surface.
 */
export function createWorkOrganizationCapabilities(
  options: CreateWorkOrganizationCapabilitiesOptions,
): WorkOrganizationModule {
  // Without the wake seam the plane still works: mentions are still parsed and
  // stored, they just do not wake anyone. That keeps Boards usable in
  // deployments where direct chat is off.
  const wake = options.wake;
  const roster = wake
    ? createManagedAgentMentionRoster(wake.definitions)
    : undefined;
  const wakeLoopGuard = wake
    ? new PostgresWakeLoopGuardRepository(options.database)
    : undefined;
  const service = new WorkOrganizationService({
    repository: new PostgresWorkOrganizationRepository(options.database),
    workIdentity: options.work.identity,
    workListProjection: options.work.projection.getWorkListItem,
    ...(options.conversations ? { conversations: options.conversations } : {}),
    ...(wake && roster
      ? {
          mentionRoster: roster,
          wakeMentionedAgents: async (input) =>
            wakeMentionedAgents(
              {
                roster,
                conversations: wake.conversations,
                dispatches: wake.dispatches,
                ...(wake.debounceMs === undefined
                  ? {}
                  : { debounceMs: wake.debounceMs }),
                ...(wakeLoopGuard ? { wakeLoopGuard } : {}),
                ...(options.logger ? { logger: options.logger } : {}),
              },
              input,
            ),
        }
      : {}),
  });
  const agentIdentities = new PostgresConversationAgentIdentityResolver(
    options.database,
  );

  return {
    service,
    installHttp(app, config) {
      registerWorkOrganizationRoutes(app, { config, service });
    },
    contributeRuntime(context) {
      registerWorkOrganizationMcpTools({
        ...context,
        service,
        agentIdentities,
      });
    },
  };
}
