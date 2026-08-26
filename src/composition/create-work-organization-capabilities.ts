import type { Hono } from 'hono';

import { createProductProjection } from '../application/product-projection/product-projection.js';
import { WorkProjectionFactsSource } from '../application/product-projection/work-projection-facts-source.js';
import { QueryWorkProjectionFacts } from '../application/work/query-work-projection-facts.js';
import { WorkIdentityApi } from '../application/work/work-identity-api.js';
import { WorkOrganizationService } from '../application/work-organization/work-organization-service.js';
import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import type { DefinitionReadApi } from '../application/ports/definition-read-api.js';
import type { ExecutionFactQuery } from '../application/ports/execution-fact-query.js';
import type { WorkDefinitionResolutionPort } from '../application/ports/work-definition-resolution.js';
import type { WorkIdentityOwnerScope } from '../application/ports/work-identity-repository.js';
import { registerWorkOrganizationRoutes } from '../entrypoints/api/routes/work-organization.js';
import type { ApiEnvironment } from '../entrypoints/api/http-types.js';
import {
  PostgresWorkIdentityRepository,
  type WorkIdentityConnectable,
} from '../infrastructure/postgres/postgres-work-identity-repository.js';
import { PostgresWorkOrganizationRepository } from '../infrastructure/postgres/postgres-work-organization-repository.js';
import { PostgresWorkProjectionFactsQuery } from '../infrastructure/postgres/postgres-work-projection-facts-query.js';
import type { AppConfig } from '../shared/config.js';

export interface WorkOrganizationModule {
  readonly service: WorkOrganizationService;
  installHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
}

export interface CreateWorkOrganizationCapabilitiesOptions {
  readonly database: WorkIdentityConnectable;
  readonly definitions: Pick<
    DefinitionReadApi,
    'findTeamDefinitionById' | 'findPublishedTeamVersionById'
  >;
  readonly definitionResolution?: WorkDefinitionResolutionPort;
  readonly executionFacts: ExecutionFactQuery;
  readonly conversations?: Pick<
    ConversationRepository,
    'getConversation' | 'listMessages'
  >;
}

/**
 * Product coordination sits above the existing Work execution plane. It owns
 * WorkItems/Boards but creates formal Work only through WorkIdentityApi.
 */
export function createWorkOrganizationCapabilities(
  options: CreateWorkOrganizationCapabilitiesOptions,
): WorkOrganizationModule {
  const workIdentityRepository = new PostgresWorkIdentityRepository(
    options.database,
  );
  const workIdentity = new WorkIdentityApi({
    repository: workIdentityRepository,
    definitions: options.definitions,
    ...(options.definitionResolution
      ? { definitionResolution: options.definitionResolution }
      : {}),
  });
  const workIdentityQuery = {
    findWorkById: (id: string, owner: WorkIdentityOwnerScope) =>
      workIdentityRepository.findWorkById(id, owner),
    findWorkRunById: (id: string, owner: WorkIdentityOwnerScope) =>
      workIdentityRepository.findWorkRunById(id, owner),
    findLatestVisibleWorkRun: (workId: string, owner: WorkIdentityOwnerScope) =>
      workIdentityRepository.findLatestVisibleWorkRun(workId, owner),
  };
  const workFacts = new WorkProjectionFactsSource(
    new QueryWorkProjectionFacts(
      new PostgresWorkProjectionFactsQuery(options.database),
    ),
  );
  const projection = createProductProjection({
    workIdentity: workIdentityQuery,
    workFacts,
    executionFacts: options.executionFacts,
  });
  const service = new WorkOrganizationService({
    repository: new PostgresWorkOrganizationRepository(options.database),
    workIdentity,
    workListProjection: projection.getWorkListItem,
    ...(options.conversations ? { conversations: options.conversations } : {}),
  });

  return {
    service,
    installHttp(app, config) {
      registerWorkOrganizationRoutes(app, { config, service });
    },
  };
}
