import { PaseoRuntimeAdapter } from '../../adapters/paseo/paseo-runtime-adapter.js';
import { UnavailableRuntime } from '../../adapters/runtime/unavailable-runtime.js';
import type { RuntimeExtensionBinder } from '../../application/extensions/runtime-extension-binder.js';
import {
  RuntimeReadinessProbe,
  type ReadinessProbe,
} from '../../application/health/readiness.js';
import type { AgentRuntimePort } from '../../application/ports/agent-runtime.js';
import type { RuntimeSessionRepository } from '../../application/ports/runtime-session-repository.js';
import { LocalRuntimeExtensionBinder } from '../../infrastructure/extensions/local-runtime-extension-binder.js';
import { RuntimeMcpServer } from '../../infrastructure/extensions/runtime-mcp-server.js';
import { PostgresRuntimeSessionRepository } from '../../infrastructure/postgres/postgres-runtime-session-repository.js';
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
  readonly runtime: AgentRuntimePort;
  readonly sessions: RuntimeSessionRepository;
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
  const runtime =
    options.debugRuntime ??
    (runtimeAdapter === 'none'
      ? new UnavailableRuntime()
      : new PaseoRuntimeAdapter(
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
        ));
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

  return {
    runtime,
    sessions: new PostgresRuntimeSessionRepository(options.database),
    extensions,
    readiness: new RuntimeReadinessProbe(runtime),
    ...(options.config.paseo.runtimeCellRoot
      ? { runtimeCellRoot: options.config.paseo.runtimeCellRoot }
      : {}),
    mcpHost,
  };
}
