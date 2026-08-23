import { PaseoExecutionPlane } from '../../adapters/paseo/paseo-execution-plane.js';
import { UnavailableExecutionPlane } from '../../adapters/runtime/unavailable-execution-plane.js';
import type { RuntimeExtensionBinder } from '../../application/extensions/runtime-extension-binder.js';
import { RuntimeToolGrantService } from '../../application/extensions/runtime-tool-grant-service.js';
import {
  RuntimeReadinessProbe,
  type ReadinessProbe,
} from '../../application/health/readiness.js';
import type {
  ExecutionPlaneCapabilities,
  ExecutionPlanePort,
} from '../../application/ports/execution-plane.js';
import type { RuntimeExecutionProvider } from '../../application/ports/runtime-execution-provider.js';
import type { RuntimeSessionRepository } from '../../application/ports/runtime-session-repository.js';
import type { RuntimeWorkspaceRepository } from '../../application/ports/runtime-workspace-repository.js';
import {
  ExecutionPlaneRuntimeFacade,
  type ExecutionRuntimeService,
} from '../../application/runtime/execution-plane-runtime-facade.js';
import { ContextAwareExecutionRuntime } from '../../application/runtime/context-aware-execution-runtime.js';
import { ContextMemoryService } from '../../application/context/context-memory-service.js';
import { ScopedMemoryResolver } from '../../application/context/scoped-memory-resolver.js';
import { ExecutionRunRegistry } from '../../application/runtime/execution-run-registry.js';
import { LocalRuntimeExtensionBinder } from '../../infrastructure/extensions/local-runtime-extension-binder.js';
import { RuntimeMcpServer } from '../../infrastructure/extensions/runtime-mcp-server.js';
import { LocalRuntimeMemoryCandidateCollector } from '../../infrastructure/files/runtime-memory-artifact-collector.js';
import { PostgresLogicalFileStore } from '../../infrastructure/postgres/postgres-logical-file-store.js';
import { PostgresMemoryContextRepository } from '../../infrastructure/postgres/postgres-memory-context-repository.js';
import { PostgresRuntimeSessionLookup } from '../../infrastructure/postgres/postgres-runtime-session-lookup.js';
import { PostgresRuntimeSessionRepository } from '../../infrastructure/postgres/postgres-runtime-session-repository.js';
import { PostgresRuntimeToolGrantPersistence } from '../../infrastructure/postgres/postgres-runtime-tool-grant-persistence.js';
import { PostgresRuntimeWorkspaceRepository } from '../../infrastructure/postgres/postgres-runtime-workspace-repository.js';
import { PostgresWorkerRuntimeInvocationResolver } from '../../infrastructure/postgres/postgres-worker-runtime-invocation-resolver.js';
import {
  RuntimeToolRegistry,
  type RuntimeToolContributor,
} from '../../platform/runtime-tool-registry.js';
import type { AppConfig } from '../../shared/config.js';
import type { Logger } from '../../shared/observability/logger.js';
import { mapPaseoConfig } from '../../infrastructure/runtime/paseo/paseo-config-mapper.js';
import { createPaseoRuntimeProvider } from '../../infrastructure/runtime/paseo/paseo-runtime-provider.js';
import { UnavailableRuntimeProvider } from '../../infrastructure/runtime/unavailable-runtime-provider.js';

export interface RuntimeExtensionControl extends RuntimeExtensionBinder {
  revokeForTeamRun(teamRunId: string): Promise<void>;
}

export interface RuntimeMcpHostLifecycle {
  start(): Promise<string>;
  stop(): Promise<void>;
}

export interface RuntimeModule {
  readonly executionRuntime: ExecutionRuntimeService;
  readonly executionPlane: ExecutionPlanePort;
  /** Phase-2 provider seam, including the explicit disabled-runtime node. */
  readonly runtimeProvider: RuntimeExecutionProvider;
  readonly executionRuns: ExecutionRunRegistry;
  readonly sessions: RuntimeSessionRepository;
  readonly workspaces: RuntimeWorkspaceRepository;
  readonly extensions: RuntimeExtensionControl;
  readonly readiness: ReadinessProbe;
  readonly runtimeCellRoot?: string;
  readonly mcpHost: RuntimeMcpHostLifecycle;
  capabilities(): ExecutionPlaneCapabilities;
  /** Composition-root only until R3 freezes the final contributor graph. */
  registerToolContributor(contributor: RuntimeToolContributor): void;
}

export interface RuntimeModuleDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

function createRuntimeProvider(options: {
  readonly adapter: 'none' | 'paseo';
  readonly config: Pick<AppConfig, 'paseo'>;
  readonly logger: Logger;
}): RuntimeExecutionProvider {
  return options.adapter === 'none'
    ? new UnavailableRuntimeProvider()
    : createPaseoRuntimeProvider(options.config, options.logger);
}

export function createRuntimeModule(options: {
  readonly database: RuntimeModuleDatabase;
  readonly config: Pick<
    AppConfig,
    'paseo' | 'runtime' | 'runtimeMcp' | 'skillRegistryRoot'
  >;
  readonly logger: Logger;
  readonly toolContributors: readonly RuntimeToolContributor[];
  readonly debugRuntime?: ExecutionRuntimeService;
  readonly scopedMemory?: Pick<ScopedMemoryResolver, 'resolve'>;
}): RuntimeModule {
  const runtimeAdapter = options.config.runtime?.adapter ?? 'paseo';
  const paseoConfig = mapPaseoConfig(options.config);
  const sessions = new PostgresRuntimeSessionRepository(options.database);
  const sessionLookup = new PostgresRuntimeSessionLookup(options.database);
  const workspaces = new PostgresRuntimeWorkspaceRepository(options.database);
  const executionRuns = new ExecutionRunRegistry();
  const executionPlane: ExecutionPlanePort =
    runtimeAdapter === 'none'
      ? new UnavailableExecutionPlane()
      : new PaseoExecutionPlane(paseoConfig, options.logger);
  const runtimeProvider = createRuntimeProvider({
    adapter: runtimeAdapter,
    config: options.config,
    logger: options.logger,
  });
  const executionPlaneRuntime = new ExecutionPlaneRuntimeFacade(
    executionPlane,
    sessions,
    sessionLookup,
    workspaces,
    executionRuns,
    new LocalRuntimeMemoryCandidateCollector(),
    options.config.paseo.agentCwd,
    options.logger,
  );
  const scopedMemory =
    options.scopedMemory ??
    new ScopedMemoryResolver(
      new ContextMemoryService(
        new PostgresMemoryContextRepository(options.database),
        new PostgresLogicalFileStore(options.database),
      ),
    );
  const productionExecutionRuntime = new ContextAwareExecutionRuntime(
    executionPlaneRuntime,
    new PostgresWorkerRuntimeInvocationResolver(options.database),
    scopedMemory,
  );
  const executionRuntime = options.debugRuntime ?? productionExecutionRuntime;
  const toolRegistry = new RuntimeToolRegistry(options.toolContributors);
  const grantService = new RuntimeToolGrantService(
    new PostgresRuntimeToolGrantPersistence(options.database),
  );
  const mcpHost = new RuntimeMcpServer(
    toolRegistry,
    grantService,
    options.config.runtimeMcp?.listenHost,
    options.config.runtimeMcp?.advertisedHost,
    options.config.runtimeMcp?.port,
  );
  const extensions = new LocalRuntimeExtensionBinder(
    options.config.paseo.agentCwd,
    options.config.skillRegistryRoot,
    mcpHost,
    options.logger,
  );

  const readiness: ReadinessProbe = options.debugRuntime
    ? {
        async check() {
          const health = await options.debugRuntime!.planeHealth();
          return health.checks;
        },
      }
    : new RuntimeReadinessProbe(executionPlane);

  return {
    executionRuntime,
    executionPlane,
    runtimeProvider,
    executionRuns,
    sessions,
    workspaces,
    extensions,
    readiness,
    ...(options.config.paseo.runtimeCellRoot
      ? { runtimeCellRoot: options.config.paseo.runtimeCellRoot }
      : {}),
    mcpHost,
    capabilities: () => executionPlane.capabilities(),
    registerToolContributor(contributor) {
      toolRegistry.register(contributor);
    },
  };
}
