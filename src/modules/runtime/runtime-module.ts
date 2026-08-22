import { PaseoExecutionPlane } from '../../adapters/paseo/paseo-execution-plane.js';
import { UnavailableExecutionPlane } from '../../adapters/runtime/unavailable-execution-plane.js';
import type { RuntimeExtensionBinder } from '../../application/extensions/runtime-extension-binder.js';
import {
  RuntimeReadinessProbe,
  type ReadinessProbe,
} from '../../application/health/readiness.js';
import type {
  ExecutionPlaneCapabilities,
  ExecutionPlanePort,
} from '../../application/ports/execution-plane.js';
import type { RuntimeSessionRepository } from '../../application/ports/runtime-session-repository.js';
import type { RuntimeWorkspaceRepository } from '../../application/ports/runtime-workspace-repository.js';
import {
  ExecutionPlaneRuntimeFacade,
  type ExecutionRuntimeService,
} from '../../application/runtime/execution-plane-runtime-facade.js';
import { ContextAwareExecutionRuntime } from '../../application/runtime/context-aware-execution-runtime.js';
import type { ScopedMemoryResolver } from '../../application/context/scoped-memory-resolver.js';
import { ExecutionRunRegistry } from '../../application/runtime/execution-run-registry.js';
import { LocalRuntimeExtensionBinder } from '../../infrastructure/extensions/local-runtime-extension-binder.js';
import { RuntimeMcpServer } from '../../infrastructure/extensions/runtime-mcp-server.js';
import { LocalRuntimeMemoryCandidateCollector } from '../../infrastructure/files/runtime-memory-artifact-collector.js';
import { PostgresRuntimeSessionLookup } from '../../infrastructure/postgres/postgres-runtime-session-lookup.js';
import { PostgresRuntimeSessionRepository } from '../../infrastructure/postgres/postgres-runtime-session-repository.js';
import { PostgresRuntimeWorkspaceRepository } from '../../infrastructure/postgres/postgres-runtime-workspace-repository.js';
import { PostgresWorkerRuntimeInvocationResolver } from '../../infrastructure/postgres/postgres-worker-runtime-invocation-resolver.js';
import {
  RuntimeToolRegistry,
  type RuntimeToolContributor,
} from '../../platform/runtime-tool-registry.js';
import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import type { AppConfig } from '../../shared/config.js';
import type { Logger } from '../../shared/observability/logger.js';

export interface RuntimeExtensionControl extends RuntimeExtensionBinder {
  revokeForTeamRun(teamRunId: string): void;
}

export interface RuntimeMcpHostLifecycle {
  stop(): Promise<void>;
}

export interface RuntimeModule {
  readonly executionRuntime: ExecutionRuntimeService;
  readonly executionPlane: ExecutionPlanePort;
  readonly executionRuns: ExecutionRunRegistry;
  readonly sessions: RuntimeSessionRepository;
  readonly workspaces: RuntimeWorkspaceRepository;
  readonly extensions: RuntimeExtensionControl;
  readonly readiness: ReadinessProbe;
  readonly runtimeCellRoot?: string;
  readonly mcpHost: RuntimeMcpHostLifecycle;
  capabilities(): ExecutionPlaneCapabilities;
  /** Composition-root only; not a runtime/user plugin API. */
  registerToolContributor(contributor: RuntimeToolContributor): void;
}

function normalizePaseoRequestedModel(
  provider: ManagedEnvironmentProvider,
  model: string,
): string {
  const prefix = 'opencode-go/';
  const stripsProviderPrefix = provider === 'claude' || provider === 'codex';
  return stripsProviderPrefix && model.startsWith(prefix)
    ? model.slice(prefix.length)
    : model;
}

export function createRuntimeModule(options: {
  readonly database: {
    query(
      sql: string,
      values?: readonly unknown[],
    ): Promise<{ rows?: readonly any[] }>;
  };
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
  const sessions = new PostgresRuntimeSessionRepository(options.database);
  const sessionLookup = new PostgresRuntimeSessionLookup(options.database);
  const workspaces = new PostgresRuntimeWorkspaceRepository(options.database);
  const executionRuns = new ExecutionRunRegistry();
  const executionPlane: ExecutionPlanePort =
    runtimeAdapter === 'none'
      ? new UnavailableExecutionPlane()
      : new PaseoExecutionPlane(
          {
            wsUrl: options.config.paseo.wsUrl,
            provider: options.config.paseo.provider,
            cwd: options.config.paseo.agentCwd,
            workspaceTitle: options.config.paseo.workspaceTitle,
            ...(options.config.paseo.model
              ? {
                  requestedModel: normalizePaseoRequestedModel(
                    options.config.paseo.provider,
                    options.config.paseo.model,
                  ),
                }
              : {}),
            connectTimeoutMs: options.config.paseo.connectTimeoutMs,
            executionTimeoutMs: options.config.paseo.executionTimeoutMs,
            executionTimeoutSource: options.config.paseo.executionTimeoutSource,
          },
          options.logger,
        );
  const executionPlaneRuntime = new ExecutionPlaneRuntimeFacade(
    executionPlane,
    sessions,
    sessionLookup,
    workspaces,
    executionRuns,
    new LocalRuntimeMemoryCandidateCollector(),
    options.config.paseo.agentCwd,
  );
  const productionExecutionRuntime = new ContextAwareExecutionRuntime(
    executionPlaneRuntime,
    new PostgresWorkerRuntimeInvocationResolver(options.database),
    options.scopedMemory,
  );
  const executionRuntime = options.debugRuntime ?? productionExecutionRuntime;
  const toolRegistry = new RuntimeToolRegistry(options.toolContributors);
  const mcpHost = new RuntimeMcpServer(
    toolRegistry,
    undefined,
    options.config.runtimeMcp?.listenHost,
    options.config.runtimeMcp?.advertisedHost,
  );
  const extensions = new LocalRuntimeExtensionBinder(
    options.config.paseo.agentCwd,
    options.config.skillRegistryRoot,
    mcpHost,
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
