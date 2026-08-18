import type { Hono } from 'hono';

import { GetProductExecutionDetail } from '../../application/product-projection/get-product-execution-detail.js';
import {
  createProductProjection,
  type ProductProjectionApi,
} from '../../application/product-projection/product-projection.js';
import { WorkProjectionFactsSource } from '../../application/product-projection/work-projection-facts-source.js';
import type { ExecutionAdmission } from '../../application/ports/execution-admission.js';
import type { ExecutionFactQuery } from '../../application/ports/execution-fact-query.js';
import type { DefinitionReadApi } from '../../application/ports/definition-read-api.js';
import type { ExecutionPlaneCapabilities } from '../../application/ports/execution-plane.js';
import type { ProductWorkListQuery } from '../../application/ports/product-work-list-query.js';
import type { WorkDefinitionResolutionPort } from '../../application/ports/work-definition-resolution.js';
import type { WorkIdentityOwnerScope } from '../../application/ports/work-identity-repository.js';
import { StartWorkRun } from '../../application/work/start-work-run.js';
import { QueryWorkProjectionFacts } from '../../application/work/query-work-projection-facts.js';
import { validateProductWorkDefinition } from '../../application/work/validate-product-work-definition.js';
import { WorkIdentityApi } from '../../application/work/work-identity-api.js';
import type { RuntimeToolContributor } from '../../platform/runtime-tool-registry.js';
import { registerProductWorkCommandRoutes } from '../../entrypoints/api/routes/product-work-commands.js';
import { registerProductWorkRoutes } from '../../entrypoints/api/routes/product-work.js';
import { registerProductWorkMcpTools } from '../../entrypoints/mcp/product-work-mcp-tools.js';
import {
  PostgresWorkIdentityRepository,
  type WorkIdentityConnectable,
} from '../../infrastructure/postgres/postgres-work-identity-repository.js';
import { PostgresRunEventRepository } from '../../infrastructure/postgres/postgres-run-event-repository.js';
import { PostgresWorkDefinitionSourceRepository } from '../../infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresProductWorkListQuery } from '../../infrastructure/postgres/postgres-product-work-list-query.js';
import { PostgresWorkProjectionFactsQuery } from '../../infrastructure/postgres/postgres-work-projection-facts-query.js';
import { PostgresWorkRunInputStore } from '../../infrastructure/postgres/postgres-work-run-input-store.js';
import type { ApiEnvironment } from '../../platform/http-types.js';
import type { AppConfig } from '../../shared/config.js';

export interface WorkModule {
  readonly projection: ProductProjectionApi;
  installHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
  readonly contributeRuntime: RuntimeToolContributor;
}

export function installWorkHttpRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
  dependencies: {
    readonly workIdentity: Pick<
      WorkIdentityApi,
      | 'createWork'
      | 'listWorks'
      | 'listWorkRuns'
      | 'getWorkDefinition'
      | 'updateCurrentDefinitionVersion'
    >;
    readonly productLists: ProductWorkListQuery;
    readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
    readonly projection: ProductProjectionApi;
    readonly executionDetail: Pick<GetProductExecutionDetail, 'execute'>;
  },
): void {
  const {
    workIdentity,
    productLists,
    startWorkRun,
    projection,
    executionDetail,
  } = dependencies;
  registerProductWorkCommandRoutes(app, {
    config,
    workIdentity,
    productLists,
    startWorkRun,
    workListProjection: projection.getWorkListItem,
    workExists: projection.getWork,
  });
  registerProductWorkRoutes(app, {
    config,
    productProjection: projection,
    executionDetail,
  });
}

export function createWorkModule(options: {
  readonly database: WorkIdentityConnectable;
  readonly definitions: Pick<
    DefinitionReadApi,
    'findTeamDefinitionById' | 'findPublishedTeamVersionById'
  >;
  /** Production supplies the generic Composition resolver; legacy tests may omit it. */
  readonly definitionResolution?: WorkDefinitionResolutionPort;
  readonly execution: ExecutionAdmission;
  readonly executionFacts: ExecutionFactQuery;
  /** Production supplies the RuntimeModule capability authority. */
  readonly runtimeCapabilities?: {
    capabilities(): ExecutionPlaneCapabilities;
  };
}): WorkModule {
  const repository = new PostgresWorkIdentityRepository(options.database);
  const productLists = new PostgresProductWorkListQuery(options.database);
  const definitionSources = new PostgresWorkDefinitionSourceRepository(
    options.database,
  );
  const workIdentity = new WorkIdentityApi({
    repository,
    definitions: options.definitions,
    ...(options.definitionResolution
      ? { definitionResolution: options.definitionResolution }
      : {}),
  });
  const startWorkRun = new StartWorkRun({
    identity: workIdentity,
    execution: options.execution,
    ...(options.runtimeCapabilities
      ? { runtimeCapabilities: options.runtimeCapabilities }
      : {}),
    productDefinitions: {
      async getInputContract({ versionId, accessContext }) {
        const productVersion = await definitionSources.findProductVersion(
          versionId,
          {
            tenantId: accessContext.tenantId,
            workspaceId: accessContext.workspaceId,
            principalType: accessContext.principalType,
            principalId: accessContext.principalId,
          },
        );
        if (!productVersion) return null;
        const parsed = validateProductWorkDefinition(
          JSON.stringify(productVersion.authorSource),
        );
        if (!parsed.valid)
          throw new Error('Persisted Product Work Definition is invalid.');
        return {
          name: parsed.document.metadata.name,
          description: parsed.document.metadata.description ?? null,
          schema: parsed.document.spec.input_schema,
        };
      },
    },
    workRunInputs: new PostgresWorkRunInputStore(options.database),
  });
  const workIdentityQuery = {
    findWorkById: (id: string, owner: WorkIdentityOwnerScope) =>
      repository.findWorkById(id, owner),
    findWorkRunById: (id: string, owner: WorkIdentityOwnerScope) =>
      repository.findWorkRunById(id, owner),
    findLatestVisibleWorkRun: (workId: string, owner: WorkIdentityOwnerScope) =>
      repository.findLatestVisibleWorkRun(workId, owner),
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
  const executionDetail = new GetProductExecutionDetail(
    workIdentityQuery,
    workFacts,
    options.executionFacts,
    new PostgresRunEventRepository(options.database),
  );

  return {
    projection,
    installHttp(app, config) {
      installWorkHttpRoutes(app, config, {
        workIdentity,
        productLists,
        startWorkRun,
        projection,
        executionDetail,
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
