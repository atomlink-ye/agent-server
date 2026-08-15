import { PaseoExecutionPlane } from '../../adapters/paseo/paseo-execution-plane.js';
import {
  isExecutionRuntimeService,
  LegacyAgentRuntimeExecutionService,
} from '../../adapters/runtime/legacy-agent-runtime-execution-service.js';
import { UnavailableExecutionPlane } from '../../adapters/runtime/unavailable-execution-plane.js';
import type { RuntimeExtensionBinder } from '../../application/extensions/runtime-extension-binder.js';
import {
  RuntimeReadinessProbe,
  type ReadinessProbe,
} from '../../application/health/readiness.js';
import type { AgentRuntimePort } from '../../application/ports/agent-runtime.js';
import type { ExecutionPlanePort } from '../../application/ports/execution-plane.js';
import type { RuntimeSessionRepository } from '../../application/ports/runtime-session-repository.js';
import type { RuntimeWorkspaceRepository } from '../../application/ports/runtime-workspace-repository.js';
import {
  ExecutionPlaneRuntimeFacade,
  type ExecutionRuntimeService,
} from '../../application/runtime/execution-plane-runtime-facade.js';
import { ExecutionRunRegistry } from '../../application/runtime/execution-run-registry.js';
import { LocalRuntimeExtensionBinder } from '../../infrastructure/extensions/local-runtime-extension-binder.js';
import { RuntimeMcpServer } from '../../infrastructure/extensions/runtime-mcp-server.js';
import { LocalRuntimeMemoryCandidateCollector } from '../../infrastructure/files/runtime-memory-artifact-collector.js';
import { PostgresRuntimeSessionLookup } from '../../infrastructure/postgres/postgres-runtime-session-lookup.js';
import { PostgresRuntimeSessionRepository } from '../../infrastructure/postgres/postgres-runtime-session-repository.js';
import { PostgresRuntimeWorkspaceRepository } from '../../infrastructure/postgres/postgres-runtime-workspace-repository.js';
import {
  RuntimeToolRegistry,
  type RuntimeToolContributor,
} from '../../platform/runtime-tool-registry.js';
import type { AppConfig } from '../../shared/config.js';
import type { Logger } from '../../shared/observability/logger.js';

export interface RuntimeExtensionControl extends RuntimeExtensionBinder {
  revokeForTeamRun(teamRunId: string): void;
}

export interface RuntimeMcpHostLifecycle {
  stop(): Promise<void>;
}

export interface RuntimeModule {
  /** @deprecated Temporary compatibility for the two channel memory callers. */
  readonly runtime: AgentRuntimePort;
  readonly executionRuntime: ExecutionRuntimeService;
  readonly executionPlane: ExecutionPlanePort;
  readonly executionRuns: ExecutionRunRegistry;
  readonly sessions: RuntimeSessionRepository;
  readonly workspaces: RuntimeWorkspaceRepository;
  readonly extensions: RuntimeExtensionControl;
  readonly readiness: ReadinessProbe;
  readonly runtimeCellRoot?: string;
  readonly mcpHost: RuntimeMcpHostLifecycle;
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
  readonly debugRuntime?: AgentRuntimePort;
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
              ? { requestedModel: options.config.paseo.model }
              : {}),
            connectTimeoutMs: options.config.paseo.connectTimeoutMs,
            executionTimeoutMs: options.config.paseo.executionTimeoutMs,
            executionTimeoutSource: options.config.paseo.executionTimeoutSource,
          },
          options.logger,
        );
  const productionExecutionRuntime = new ExecutionPlaneRuntimeFacade(
    executionPlane,
    sessions,
    sessionLookup,
    workspaces,
    executionRuns,
    new LocalRuntimeMemoryCandidateCollector(),
    options.config.paseo.agentCwd,
  );
  const executionRuntime: ExecutionRuntimeService = options.debugRuntime
    ? isExecutionRuntimeService(options.debugRuntime)
      ? options.debugRuntime
      : new LegacyAgentRuntimeExecutionService(options.debugRuntime)
    : productionExecutionRuntime;
  const runtime: AgentRuntimePort =
    options.debugRuntime ?? productionExecutionRuntime;
  const mcpHost = new RuntimeMcpServer(
    new RuntimeToolRegistry(options.toolContributors),
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
          const health = await options.debugRuntime!.health();
          return health.checks;
        },
      }
    : new RuntimeReadinessProbe(executionPlane);

  return {
    runtime,
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
  };
}
