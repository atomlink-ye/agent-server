import type { Hono } from 'hono';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createProductProjection,
  type ProductProjectionApi,
} from '../../application/product-projection/product-projection.js';
import { WorkProjectionFactsSource } from '../../application/product-projection/work-projection-facts-source.js';
import type { ExecutionAdmission } from '../../application/ports/execution-admission.js';
import type { ExecutionFactQuery } from '../../application/ports/execution-fact-query.js';
import type { WorkDefinitionReadPort } from '../../application/ports/work-definition-read.js';
import type { StartWorkRun } from '../../application/work/start-work-run.js';
import { QueryWorkProjectionFacts } from '../../application/work/query-work-projection-facts.js';
import type { WorkIdentityApi } from '../../application/work/work-identity-api.js';
import type {
  RuntimeToolGrant,
  RuntimeToolGrantService,
} from '../../application/extensions/runtime-tool-grant-service.js';
import { registerProductWorkCommandRoutes } from '../../entrypoints/api/routes/product-work-commands.js';
import { registerProductWorkRoutes } from '../../entrypoints/api/routes/product-work.js';
import { registerProductWorkMcpTools } from '../../entrypoints/mcp/product-work-mcp-tools.js';
import {
  createPostgresWorkIdentityModule,
  type WorkIdentityConnectable,
} from '../../infrastructure/postgres/postgres-work-identity-repository.js';
import { PostgresWorkProjectionFactsQuery } from '../../infrastructure/postgres/postgres-work-projection-facts-query.js';
import type { ApiEnvironment } from '../../platform/http-types.js';
import type { AppConfig } from '../../shared/config.js';

export interface WorkRuntimeContributionContext {
  readonly server: McpServer;
  readonly grant: RuntimeToolGrant;
  readonly grants: RuntimeToolGrantService;
}

export type WorkRuntimeContributor = (
  context: WorkRuntimeContributionContext,
) => void;

export interface WorkModule {
  readonly projection: ProductProjectionApi;
  installHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
  readonly contributeRuntime: WorkRuntimeContributor;
}

export function installWorkHttpRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
  dependencies: {
    readonly workIdentity: Pick<
      WorkIdentityApi,
      'createWork' | 'listWorks' | 'listWorkRuns' | 'getWorkDefinition'
    >;
    readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
    readonly projection: ProductProjectionApi;
  },
): void {
  const { workIdentity, startWorkRun, projection } = dependencies;
  registerProductWorkCommandRoutes(app, {
    config,
    workIdentity,
    startWorkRun,
    workListProjection: projection.getWorkListItem,
    workExists: projection.getWork,
  });
  registerProductWorkRoutes(app, {
    config,
    productProjection: projection,
  });
}

export function createWorkModule(options: {
  readonly database: WorkIdentityConnectable;
  readonly definitions: WorkDefinitionReadPort;
  readonly execution: ExecutionAdmission;
  readonly executionFacts: ExecutionFactQuery;
}): WorkModule {
  const { workIdentity, workIdentityQuery, startWorkRun } =
    createPostgresWorkIdentityModule(options);
  const projection = createProductProjection({
    workIdentity: workIdentityQuery,
    workFacts: new WorkProjectionFactsSource(
      new QueryWorkProjectionFacts(
        new PostgresWorkProjectionFactsQuery(options.database),
      ),
    ),
    executionFacts: options.executionFacts,
  });

  return {
    projection,
    installHttp(app, config) {
      installWorkHttpRoutes(app, config, {
        workIdentity,
        startWorkRun,
        projection,
      });
    },
    contributeRuntime(context) {
      registerProductWorkMcpTools({
        ...context,
        workIdentity,
        startWorkRun,
      });
    },
  };
}
