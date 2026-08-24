import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import type { RuntimeToolCatalog } from '../application/extensions/runtime-tool-catalog.js';
import { PostgresRuntimeSessionStore } from '../infrastructure/postgres/runtime/postgres-runtime-session-store.js';
import { PostgresRuntimeSpecStore } from '../infrastructure/postgres/runtime/postgres-runtime-spec-store.js';
import { PostgresRuntimeGenerationStore } from '../infrastructure/postgres/runtime/postgres-runtime-generation-store.js';
import { PostgresRuntimeTurnStore } from '../infrastructure/postgres/runtime/postgres-runtime-turn-store.js';
import { PostgresRuntimeTurnProvenanceQuery } from '../infrastructure/postgres/runtime/postgres-runtime-turn-provenance-query.js';
import { PostgresRuntimeGrantReader } from '../infrastructure/postgres/runtime/postgres-runtime-grant-reader.js';
import { PostgresRuntimeGrantAuthority } from '../infrastructure/postgres/runtime/postgres-runtime-grant-authority.js';
import { AuthorizeRuntimeTool } from '../application/runtime/authorize-runtime-tool.js';
import { EnsureRuntimeSessionService } from '../application/runtime/ensure-runtime-session.js';
import { ExecuteRuntimeTurn } from '../application/runtime/execute-runtime-turn.js';
import { CancelRuntimeTurn } from '../application/runtime/cancel-runtime-turn.js';
import { CancelRuntimeRun } from '../application/runtime/cancel-runtime-run.js';
import { ResolveRuntimeSessionSpecService } from '../application/runtime/resolve-runtime-session-spec.js';
import { EnsureDesiredRuntimeSpecService } from '../application/runtime/ensure-desired-runtime-spec.js';
import { RuntimeGenerationManager } from '../application/runtime/runtime-generation-manager.js';
import { createRuntimeMcpEndpoint } from './create-runtime-mcp-endpoint.js';
import { RuntimeMcpServer } from '../infrastructure/extensions/runtime-mcp-server.js';
import { createPaseoRuntimeProvider } from '../infrastructure/runtime/paseo/paseo-runtime-provider.js';
import { UnavailableRuntimeProvider } from '../infrastructure/runtime/unavailable-runtime-provider.js';
import { PaseoOneShotRuntimeCompletion } from '../infrastructure/runtime/paseo/paseo-one-shot-runtime-completion.js';
import type { OneShotRuntimeCompletion } from '../application/ports/one-shot-runtime-completion.js';
import { hashBearerToken } from '../infrastructure/security/hash-bearer-token.js';
import type { RuntimeExecutionProvider } from '../application/ports/runtime-execution-provider.js';
import type { RuntimeSessionStore } from '../application/ports/runtime-session-store.js';
import type { EnsureRuntimeSession } from '../application/ports/ensure-runtime-session.js';
import type { RuntimeMcpEndpoint } from '../application/ports/runtime-mcp-endpoint.js';
import type { ExecuteRuntimeTurn as ExecuteRuntimeTurnUseCase } from '../application/runtime/execute-runtime-turn.js';
import type { CancelRuntimeTurn as CancelRuntimeTurnUseCase } from '../application/runtime/cancel-runtime-turn.js';
import type { EnsureDesiredRuntimeSpec } from '../application/ports/ensure-desired-runtime-spec.js';

export interface RuntimeOwner {
  readonly runtimeProvider: RuntimeExecutionProvider;
  readonly runtimeSessions: RuntimeSessionStore;
  readonly ensureDesiredRuntimeSpec: EnsureDesiredRuntimeSpec;
  readonly ensureRuntimeSession: EnsureRuntimeSession;
  readonly executeRuntimeTurn: Pick<ExecuteRuntimeTurnUseCase, 'execute'>;
  readonly cancelRuntimeRun: Pick<CancelRuntimeRun, 'cancelRun'>;
  readonly chatRuntime: {
    readonly desiredSpec: EnsureDesiredRuntimeSpec;
    readonly configuration: {
      readonly provider: string;
      readonly model: string | null;
      readonly cwd: string;
    };
    readonly turnExecutor: Pick<ExecuteRuntimeTurnUseCase, 'execute'>;
  };
  readonly runtimeMcpServer: RuntimeMcpServer;
  readonly runtimeMcpEndpoint: RuntimeMcpEndpoint;
  readonly oneShotCompletion: OneShotRuntimeCompletion;
}

export function createRuntimeOwner(input: {
  readonly database: Pool;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly toolCatalog: RuntimeToolCatalog;
}): RuntimeOwner {
  const runtimeProvider =
    input.config.runtime?.adapter === 'none'
      ? new UnavailableRuntimeProvider()
      : createPaseoRuntimeProvider(input.config, input.logger);
  const oneShotCompletion = new PaseoOneShotRuntimeCompletion(runtimeProvider);
  const grants = new PostgresRuntimeGrantAuthority(input.database);
  const runtimeSessions = new PostgresRuntimeSessionStore(
    input.database,
    grants,
  );
  const specs = new PostgresRuntimeSpecStore(input.database);
  const generations = new PostgresRuntimeGenerationStore(input.database);
  const turns = new PostgresRuntimeTurnStore(input.database);
  const turnProvenance = new PostgresRuntimeTurnProvenanceQuery(input.database);
  const reader = new PostgresRuntimeGrantReader(input.database);
  const authorizeRuntimeTool = new AuthorizeRuntimeTool(
    reader,
    runtimeSessions,
    generations,
    turns,
    hashBearerToken,
  );
  const runtimeMcpServer = new RuntimeMcpServer(
    input.toolCatalog,
    authorizeRuntimeTool,
    input.config.runtimeMcp?.listenHost,
    input.config.runtimeMcp?.advertisedHost,
    input.config.runtimeMcp?.port,
  );
  const runtimeMcpEndpoint = createRuntimeMcpEndpoint(runtimeMcpServer);
  const resolveRuntimeSpec = new ResolveRuntimeSessionSpecService(
    input.toolCatalog,
    {
      digest: ({ agentVersionId, toolRefs }) =>
        `sha256:${createHash('sha256')
          .update(JSON.stringify({ agentVersionId, toolRefs }), 'utf8')
          .digest('hex')}`,
    },
  );
  const ensureDesiredRuntimeSpec = new EnsureDesiredRuntimeSpecService(
    runtimeSessions,
    specs,
    resolveRuntimeSpec,
  );
  const generationManager = new RuntimeGenerationManager({
    generations,
    generationTransaction: generations,
    grants,
    now: () => new Date(),
  });
  const ensureRuntimeSession = new EnsureRuntimeSessionService({
    provider: runtimeProvider,
    sessions: runtimeSessions,
    specs,
    generations,
    generationManager,
    grants,
    mcpEndpoint: runtimeMcpEndpoint,
    logger: input.logger,
    now: () => new Date(),
  });
  const executeRuntimeTurn = new ExecuteRuntimeTurn(
    turns,
    ensureRuntimeSession,
    grants,
    grants,
  );
  const cancelRuntimeTurn = new CancelRuntimeTurn(
    turns,
    generations,
    specs,
    runtimeProvider,
    grants,
  );
  const cancelRuntimeRun = new CancelRuntimeRun(
    turnProvenance,
    cancelRuntimeTurn,
  );
  const configuration = {
    provider: input.config.paseo.provider,
    model: input.config.paseo.model ?? null,
    cwd: input.config.paseo.agentCwd,
  };
  return {
    runtimeProvider,
    runtimeSessions,
    ensureDesiredRuntimeSpec,
    ensureRuntimeSession,
    executeRuntimeTurn,
    cancelRuntimeRun,
    chatRuntime: {
      desiredSpec: ensureDesiredRuntimeSpec,
      configuration,
      turnExecutor: executeRuntimeTurn,
    },
    runtimeMcpServer,
    runtimeMcpEndpoint,
    oneShotCompletion,
  };
}
