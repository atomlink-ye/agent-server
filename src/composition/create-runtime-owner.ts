import type { Pool } from 'pg';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import type { RuntimeToolCatalog } from '../application/extensions/runtime-tool-catalog.js';
import { PostgresRuntimeSessionStore } from '../infrastructure/postgres/runtime/postgres-runtime-session-store.js';
import { PostgresRuntimeSpecStore } from '../infrastructure/postgres/runtime/postgres-runtime-spec-store.js';
import { PostgresRuntimeGenerationStore } from '../infrastructure/postgres/runtime/postgres-runtime-generation-store.js';
import { PostgresRuntimeTurnStore } from '../infrastructure/postgres/runtime/postgres-runtime-turn-store.js';
import { PostgresRuntimeGrantReader } from '../infrastructure/postgres/runtime/postgres-runtime-grant-reader.js';
import { PostgresRuntimeGrantAuthority } from '../infrastructure/postgres/runtime/postgres-runtime-grant-authority.js';
import { AuthorizeRuntimeTool } from '../application/runtime/authorize-runtime-tool.js';
import { EnsureRuntimeSessionService } from '../application/runtime/ensure-runtime-session.js';
import { ExecuteRuntimeTurn } from '../application/runtime/execute-runtime-turn.js';
import { CancelRuntimeTurn } from '../application/runtime/cancel-runtime-turn.js';
import { AgentChatRuntimeSessionCreator } from '../application/runtime/create-agent-chat-runtime-session.js';
import { ResolveRuntimeSessionSpecService } from '../application/runtime/resolve-runtime-session-spec.js';
import { RuntimeGenerationManager } from '../application/runtime/runtime-generation-manager.js';
import { createRuntimeMcpEndpoint } from './create-runtime-mcp-endpoint.js';
import { RuntimeMcpServer } from '../infrastructure/extensions/runtime-mcp-server.js';
import { createPaseoRuntimeProvider } from '../infrastructure/runtime/paseo/paseo-runtime-provider.js';
import { UnavailableRuntimeProvider } from '../infrastructure/runtime/unavailable-runtime-provider.js';
import { hashBearerToken } from '../infrastructure/security/hash-bearer-token.js';
import type { RuntimeExecutionProvider } from '../application/ports/runtime-execution-provider.js';
import type { RuntimeSessionStore } from '../application/ports/runtime-session-store.js';
import type { ResolveRuntimeSessionSpec } from '../application/ports/resolve-runtime-session-spec.js';
import type { EnsureRuntimeSession } from '../application/ports/ensure-runtime-session.js';
import type { RuntimeMcpEndpoint } from '../application/ports/runtime-mcp-endpoint.js';
import type { ExecuteRuntimeTurn as ExecuteRuntimeTurnUseCase } from '../application/runtime/execute-runtime-turn.js';
import type { CancelRuntimeTurn as CancelRuntimeTurnUseCase } from '../application/runtime/cancel-runtime-turn.js';

export interface RuntimeOwner {
  readonly runtimeProvider: RuntimeExecutionProvider;
  readonly runtimeSessions: RuntimeSessionStore;
  readonly resolveRuntimeSpec: ResolveRuntimeSessionSpec;
  readonly ensureRuntimeSession: EnsureRuntimeSession;
  readonly executeRuntimeTurn: Pick<ExecuteRuntimeTurnUseCase, 'execute'>;
  readonly cancelRuntimeTurn: Pick<CancelRuntimeTurnUseCase, 'execute'>;
  readonly chatRuntime: {
    readonly sessionCreator: Pick<AgentChatRuntimeSessionCreator, 'execute'>;
    readonly turnExecutor: Pick<ExecuteRuntimeTurnUseCase, 'execute'>;
  };
  readonly runtimeMcpServer: RuntimeMcpServer;
  readonly runtimeMcpEndpoint: RuntimeMcpEndpoint;
}

export function createRuntimeOwner(input: {
  readonly database: Pool;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly toolCatalog: RuntimeToolCatalog;
}): RuntimeOwner {
  const runtimeProvider = input.config.runtime?.adapter === 'none'
    ? new UnavailableRuntimeProvider()
    : createPaseoRuntimeProvider(input.config, input.logger);
  const runtimeSessions = new PostgresRuntimeSessionStore(input.database);
  const specs = new PostgresRuntimeSpecStore(input.database);
  const generations = new PostgresRuntimeGenerationStore(input.database);
  const turns = new PostgresRuntimeTurnStore(input.database);
  const grants = new PostgresRuntimeGrantAuthority(input.database);
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
    { digest: () => input.toolCatalog.digest },
  );
  const generationManager = new RuntimeGenerationManager({
    generations,
    generationTransaction: generations,
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
  );
  const cancelRuntimeTurn = new CancelRuntimeTurn(
    turns,
    ensureRuntimeSession,
  );
  const sessionCreator = new AgentChatRuntimeSessionCreator(
    runtimeSessions,
    resolveRuntimeSpec,
    {
      provider: input.config.paseo.provider,
      model: input.config.paseo.model ?? null,
      cwd: input.config.paseo.agentCwd,
    },
  );
  return {
    runtimeProvider,
    runtimeSessions,
    resolveRuntimeSpec,
    ensureRuntimeSession,
    executeRuntimeTurn,
    cancelRuntimeTurn,
    chatRuntime: { sessionCreator, turnExecutor: executeRuntimeTurn },
    runtimeMcpServer,
    runtimeMcpEndpoint,
  };
}
