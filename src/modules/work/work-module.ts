import type { Hono } from 'hono';

import {
  createProductProjection,
  type ProductProjectionApi,
} from '../../application/product-projection/product-projection.js';
import { WorkProjectionFactsSource } from '../../application/product-projection/work-projection-facts-source.js';
import type { ExecutionAdmission } from '../../application/ports/execution-admission.js';
import type { ExecutionFactQuery } from '../../application/ports/execution-fact-query.js';
import type { DefinitionReadApi } from '../../application/ports/definition-read-api.js';
import type {
  ExecutionPlaneCapabilities,
  ExecutionPlanePort,
} from '../../application/ports/execution-plane.js';
import type { WorkDefinitionResolutionPort } from '../../application/ports/work-definition-resolution.js';
import type { WorkIdentityOwnerScope } from '../../application/ports/work-identity-repository.js';
import { StartWorkRun } from '../../application/work/start-work-run.js';
import { QueryWorkProjectionFacts } from '../../application/work/query-work-projection-facts.js';
import { WorkIdentityApi } from '../../application/work/work-identity-api.js';
import type { RuntimeToolContributor } from '../../platform/runtime-tool-registry.js';
import { registerProductWorkCommandRoutes } from '../../entrypoints/api/routes/product-work-commands.js';
import { registerProductWorkRoutes } from '../../entrypoints/api/routes/product-work.js';
import { registerProductWorkMcpTools } from '../../entrypoints/mcp/product-work-mcp-tools.js';
import {
  PostgresWorkIdentityRepository,
  type WorkIdentityConnectable,
} from '../../infrastructure/postgres/postgres-work-identity-repository.js';
import { PostgresWorkProjectionFactsQuery } from '../../infrastructure/postgres/postgres-work-projection-facts-query.js';
import type { ApiEnvironment } from '../../platform/http-types.js';
import type { AppConfig } from '../../shared/config.js';

const PASEO_MVE_CAPABILITIES: ExecutionPlaneCapabilities = {
  supported: new Set([
    'streaming',
    'cancellation',
    'reusable_session',
    'external_workspace',
    'timeline_replay',
    'permissions',
    'nested_activities',
    'provider_discovery',
    'platform_mcp',
  ]),
};
const NO_RUNTIME_CAPABILITIES: ExecutionPlaneCapabilities = {
  supported: new Set(),
};

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
  readonly definitions: DefinitionReadApi;
  readonly definitionResolution?: WorkDefinitionResolutionPort;
  readonly execution: ExecutionAdmission;
  readonly executionFacts: ExecutionFactQuery;
  readonly runtimeCapabilities?: Pick<ExecutionPlanePort, 'capabilities'>;
}): WorkModule {
  const definitionResolution =
    options.definitionResolution ?? options.definitions.workDefinitionResolution;
  if (!definitionResolution)
    throw new Error('Work Definition composition resolution is unavailable.');

  let configuredCapabilities =
    options.runtimeCapabilities?.capabilities() ?? PASEO_MVE_CAPABILITIES;
  const runtimeCapabilities = options.runtimeCapabilities ?? {
    capabilities: () => configuredCapabilities,
  };

  const repository = new PostgresWorkIdentityRepository(options.database);
  const workIdentity = new WorkIdentityApi({
    repository,
    definitions: options.definitions,
    definitionResolution,
  });
  const startWorkRun = new StartWorkRun({
    identity: workIdentity,
    execution: options.execution,
    runtimeCapabilities,
  });
  const workIdentityQuery = {
    findWorkById: (id: string, owner: WorkIdentityOwnerScope) =>
      repository.findWorkById(id, owner),
    findWorkRunById: (id: string, owner: WorkIdentityOwnerScope) =>
      repository.findWorkRunById(id, owner),
    findLatestVisibleWorkRun: (
      workId: string,
      owner: WorkIdentityOwnerScope,
    ) => repository.findLatestVisibleWorkRun(workId, owner),
  };
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
      if (!options.runtimeCapabilities)
        configuredCapabilities =
          config.runtime?.adapter === 'none'
            ? NO_RUNTIME_CAPABILITIES
            : PASEO_MVE_CAPABILITIES;
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
