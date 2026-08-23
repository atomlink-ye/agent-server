import type { RuntimeExtensionBinder } from '../application/extensions/runtime-extension-binder.js';
import type { RuntimeToolCatalog } from '../application/extensions/runtime-tool-catalog.js';
import { RuntimeToolGrantService } from '../application/extensions/runtime-tool-grant-service.js';
import {
  RuntimeReadinessProbe,
  type ReadinessProbe,
} from '../application/health/readiness.js';
import type { ExecutionPlaneCapabilities } from '../application/ports/execution-plane.js';
import type { ExecutionRuntimeService } from '../application/ports/execution-runtime.js';
import type { RuntimeExecutionProvider } from '../application/ports/runtime-execution-provider.js';
import type { CreateAgentChatRuntimeSession } from '../application/runtime/create-agent-chat-runtime-session.js';
import type { ExecuteRuntimeTurn } from '../application/runtime/execute-runtime-turn.js';
import type { ExecutionOutput } from '../application/ports/runtime-execution-session.js';
import { ExecutionRunRegistry } from '../application/runtime/execution-run-registry.js';
import { RuntimeMcpServer } from '../infrastructure/extensions/runtime-mcp-server.js';
import { LocalRuntimeExtensionBinder } from '../infrastructure/extensions/local-runtime-extension-binder.js';
import { PostgresRuntimeToolGrantPersistence } from '../infrastructure/postgres/postgres-runtime-tool-grant-persistence.js';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import { createPaseoExecutionPlane } from '../infrastructure/runtime/paseo/paseo-config-mapper.js';
import { createPaseoRuntimeProvider } from '../infrastructure/runtime/paseo/paseo-runtime-provider.js';
import { UnavailableRuntimeProvider } from '../infrastructure/runtime/unavailable-runtime-provider.js';
import { createRuntimeMcpEndpoint } from './create-runtime-mcp-endpoint.js';

export interface RuntimeExtensionControl extends RuntimeExtensionBinder {
  revokeForTeamRun(teamRunId: string): Promise<void>;
}

export interface RuntimeMcpHostLifecycle {
  start(): Promise<string>;
  stop(): Promise<void>;
}

export interface RuntimeModule {
  readonly executionRuntime: ExecutionRuntimeService;
  readonly runtimeProvider: RuntimeExecutionProvider;
  readonly executionRuns: ExecutionRunRegistry;
  readonly extensions: RuntimeExtensionControl;
  readonly readiness: ReadinessProbe;
  readonly runtimeCellRoot?: string;
  readonly runtimeMcpServer: RuntimeMcpHostLifecycle;
  readonly runtimeMcpEndpoint: ReturnType<typeof createRuntimeMcpEndpoint>;
  readonly chatRuntime: {
    readonly sessionCreator: Pick<CreateAgentChatRuntimeSession, 'execute'>;
    readonly turnExecutor: Pick<ExecuteRuntimeTurn, 'execute'>;
  };
  capabilities(): ExecutionPlaneCapabilities;
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

/**
 * Composes the runtime-owned infrastructure. Runtime session reconciliation is
 * intentionally supplied by the next runtime-authority pass; the graph still
 * exposes one execution seam so tests can inject a deterministic runtime.
 */
export function createRuntimeModule(options: {
  readonly database: RuntimeModuleDatabase;
  readonly config: Pick<
    AppConfig,
    'paseo' | 'runtime' | 'runtimeMcp' | 'skillRegistryRoot'
  >;
  readonly logger: Logger;
  readonly toolCatalog: RuntimeToolCatalog;
  readonly debugRuntime?: ExecutionRuntimeService;
}): RuntimeModule {
  const runtimeAdapter = options.config.runtime?.adapter ?? 'paseo';
  const executionPlane =
    runtimeAdapter === 'none'
      ? null
      : createPaseoExecutionPlane(options.config, options.logger);
  const runtimeProvider = createRuntimeProvider({
    adapter: runtimeAdapter,
    config: options.config,
    logger: options.logger,
  });
  const executionRuns = new ExecutionRunRegistry();
  const grants = new RuntimeToolGrantService(
    new PostgresRuntimeToolGrantPersistence(options.database),
  );
  const runtimeMcpServer = new RuntimeMcpServer(
    options.toolCatalog,
    grants,
    options.config.runtimeMcp?.listenHost,
    options.config.runtimeMcp?.advertisedHost,
    options.config.runtimeMcp?.port,
  );
  const runtimeMcpEndpoint = createRuntimeMcpEndpoint(runtimeMcpServer);
  const extensions = new LocalRuntimeExtensionBinder(
    options.config.paseo.agentCwd,
    options.config.skillRegistryRoot,
    runtimeMcpServer,
    options.logger,
  );
  const executionRuntime =
    options.debugRuntime ?? createUnavailableExecutionRuntime(runtimeProvider);
  const readiness: ReadinessProbe = options.debugRuntime
    ? {
        async check() {
          const health = await options.debugRuntime!.planeHealth();
          return health.checks;
        },
      }
    : new RuntimeReadinessProbe(runtimeProvider);

  return {
    executionRuntime,
    runtimeProvider,
    executionRuns,
    extensions,
    readiness,
    ...(options.config.paseo.runtimeCellRoot
      ? { runtimeCellRoot: options.config.paseo.runtimeCellRoot }
      : {}),
    runtimeMcpServer,
    runtimeMcpEndpoint,
    chatRuntime: createChatRuntime(executionRuntime),
    capabilities: () =>
      executionPlane?.capabilities() ?? {
        supported: new Set<never>(),
      },
  };
}

function createChatRuntime(
  runtime: ExecutionRuntimeService,
): RuntimeModule['chatRuntime'] {
  return {
    sessionCreator: {
      execute: (input) => runtime.ensureAgentChatRuntimeSession(input),
    },
    turnExecutor: {
      async execute(input): Promise<ExecutionOutput> {
        const outcome = await runtime.executeTurn(
          {
            runId: input.turnId ?? input.runtimeSessionId,
            runtimeSessionId: input.runtimeSessionId,
            prompt: input.prompt,
            ...(input.recoveryPrompt
              ? { recoveryPrompt: input.recoveryPrompt }
              : {}),
          },
          input.observer,
        );
        return {
          provider: outcome.provider,
          model: outcome.model,
          text: outcome.text,
          ...(outcome.usage ? { usage: outcome.usage } : {}),
        };
      },
    },
  };
}

function createUnavailableExecutionRuntime(
  provider: RuntimeExecutionProvider,
): ExecutionRuntimeService {
  return {
    ensureReady: () => provider.ensureReady(),
    ensureAgentChatRuntimeSession: async () => {
      throw new Error('Runtime session execution is not composed.');
    },
    executeTurn: async () => {
      throw new Error('Runtime turn execution is not composed.');
    },
    cancelRun: async () => undefined,
    planeHealth: () => provider.health(),
    close: () => provider.close(),
  };
}
