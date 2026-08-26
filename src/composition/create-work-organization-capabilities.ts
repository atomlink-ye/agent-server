import type { Hono } from 'hono';
import type { Pool } from 'pg';

import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import { WorkOrganizationService } from '../application/work-organization/work-organization-service.js';
import type { ApiEnvironment } from '../entrypoints/api/http-types.js';
import { registerWorkOrganizationRoutes } from '../entrypoints/api/routes/work-organization.js';
import { PostgresWorkOrganizationRepository } from '../infrastructure/postgres/postgres-work-organization-repository.js';
import type { AppConfig } from '../shared/config.js';
import type { WorkModule } from './create-work-capabilities.js';

export interface WorkOrganizationModule {
  readonly service: WorkOrganizationService;
  installHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
}

export interface CreateWorkOrganizationCapabilitiesOptions {
  readonly database: Pick<Pool, 'query'>;
  readonly work: Pick<WorkModule, 'identity' | 'projection'>;
  readonly conversations?: Pick<
    ConversationRepository,
    'getConversation' | 'listMessages'
  >;
}

/**
 * Product coordination sits above the existing Work execution plane. It owns
 * WorkItems/Boards, while formal Work identity/projection remain composed by
 * the canonical Work module behind its application-level surface.
 */
export function createWorkOrganizationCapabilities(
  options: CreateWorkOrganizationCapabilitiesOptions,
): WorkOrganizationModule {
  const service = new WorkOrganizationService({
    repository: new PostgresWorkOrganizationRepository(options.database),
    workIdentity: options.work.identity,
    workListProjection: options.work.projection.getWorkListItem,
    ...(options.conversations ? { conversations: options.conversations } : {}),
  });

  return {
    service,
    installHttp(app, config) {
      registerWorkOrganizationRoutes(app, { config, service });
    },
  };
}
