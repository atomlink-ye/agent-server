import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  McpServer,
  type RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { MemoryApiRepository } from '../../application/ports/memory-api-repository.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import type { TeamCommandService } from '../../application/teams/team-command-service.js';
import { registerTeamMcpTools } from '../../adapters/team-mcp/team-mcp-tools.js';
import { SyntheticMarketAdapter } from '../../adapters/demo-market/synthetic-market-adapter.js';
import { CreateLearningProposal } from '../../application/learning/learning-proposals.js';
import type { LearningProposal } from '../../domain/learning/learning-proposal.js';
import type { AccessContext } from '../../application/control-plane/access-context.js';
import {
  AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import { normalizeMemoryPath } from '../../domain/memory-api/memory-api.js';
import type { Logger } from '../../shared/observability/logger.js';
import {
  AGENT_SERVER_MEMORY_READ_MCP_NAME,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  RuntimeToolGrantService,
  type RuntimeToolGrant,
} from '../../application/extensions/runtime-tool-grant-service.js';
import type { WorkIdentityApi } from '../../application/work/work-identity-api.js';
import type { StartWorkRun } from '../../application/work/start-work-run.js';
import { registerProductWorkMcpTools } from './product-work-mcp-tools.js';

export const MCP_PATH = '/mcp/agent-runtime';
const UUID = z.string().uuid();
const memoryReadInput = {
  memory_store_id: UUID,
  path: z.string(),
};
const fixtureInput = { fixture_ref: z.string(), symbol: z.string() };
const proposalInput = z
  .object({
    memory_store_id: UUID,
    target_path: z.string(),
    proposed_content: z.string(),
    evidence_refs: z.array(z.string()),
  })
  .strict();
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
type McpSession = Readonly<{
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  readonly grantId: string;
  readonly refreshTools: (allowedTools: readonly string[]) => void;
}>;

export function createDirectMemoryMcpHandler(input: {
  readonly repository: MemoryApiRepository;
  readonly grants: RuntimeToolGrantService;
  readonly teamTools?: {
    contextResolver: TeamToolContextResolver;
    commands: TeamCommandService;
  };
  readonly createLearningProposal?: CreateLearningProposal;
  readonly market?: SyntheticMarketAdapter;
  readonly logger?: Logger;
  readonly workIdentity?: Pick<WorkIdentityApi, 'createWork'>;
  readonly startWorkRun?: Pick<StartWorkRun, 'execute'>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const sessions = new Map<string, McpSession>();
  return async (req, res) => {
    if (req.url?.split('?')[0] !== MCP_PATH) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const grant = authenticate(req, input.grants);
    if (!grant) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      if ((error as { code?: string }).code === 'request_too_large') {
        sendJson(res, 413, { error: 'request_too_large' });
        return;
      }
      sendJson(res, 400, { error: 'invalid_request' });
      return;
    }
    const sessionId = req.headers['mcp-session-id'];
    if (Array.isArray(sessionId)) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const existing =
      typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (sessionId && !existing) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (existing && existing.grantId !== grant.grantId) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const server =
      existing?.server ??
      new McpServer({
        name: 'agent-server-memory-mcp',
        version: '0.1.0',
      });
    let refreshTools: (allowedTools: readonly string[]) => void =
      existing?.refreshTools ?? (() => undefined);
    let transport!: StreamableHTTPServerTransport;
    transport =
      existing?.transport ??
      new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          sessions.set(id, {
            server,
            transport,
            grantId: grant.grantId,
            refreshTools,
          });
        },
      });
    if (!existing) {
      const registeredTools = registerTools(
        server,
        grant,
        input.repository,
        input,
        input.grants,
      );
      if (input.workIdentity && input.startWorkRun)
        registerProductWorkMcpTools({
          server,
          grant,
          grants: input.grants,
          workIdentity: input.workIdentity,
          startWorkRun: input.startWorkRun,
        });
      const refreshRegisteredTools = (_allowedTools: readonly string[]) =>
        undefined;
      let refreshTeamTools: (allowedTools: readonly string[]) => void = () =>
        undefined;
      if (
        input.teamTools &&
        grant.teamMemberRunId &&
        grant.taskId &&
        grant.runId
      ) {
        refreshTeamTools = registerTeamMcpTools(
          server,
          grant.catalogTools,
          (toolRef) => input.grants.isToolAllowed(grant.grantId, toolRef),
          {
            resolve: (currentGrant) =>
              input.teamTools!.contextResolver!.resolve(currentGrant),
            grantId: grant.grantId,
            currentGrant: () => input.grants.get(grant.grantId),
            begin: (grantId) => {
              input.grants.beginToolCall(grantId);
            },
            end: (grantId) => input.grants.endToolCall(grantId),
            commands: input.teamTools.commands,
          },
        );
      }
      refreshTools = (allowedTools) => {
        void allowedTools;
      };
    }
    const newSession = !existing;
    if (newSession) {
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id && sessions.get(id)?.transport === transport)
          sessions.delete(id);
      };
    }
    try {
      if (newSession)
        await server.connect(
          transport as unknown as Parameters<typeof server.connect>[0],
        );
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      if (newSession) {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    }
    if (newSession && !transport.sessionId) {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  };
}

function registerTools(
  server: McpServer,
  grant: RuntimeToolGrant,
  repository: MemoryApiRepository,
  input: {
    readonly createLearningProposal?: CreateLearningProposal;
    readonly teamTools?: {
      contextResolver: TeamToolContextResolver;
      commands: TeamCommandService;
    };
    readonly market?: SyntheticMarketAdapter;
    readonly logger?: Logger;
  },
  grants: RuntimeToolGrantService,
): Map<string, RegisteredTool> {
  const register = (
    toolRef: string,
    name: string,
    config: any,
    operation: (args: any, currentGrant: RuntimeToolGrant) => unknown,
  ) => {
    (server.registerTool as any)(name, config, async (args: any) => {
      const currentGrant = grants.get(grant.grantId);
      if (!currentGrant || !grants.isToolAllowed(currentGrant.grantId, toolRef))
        return notFound();
      grants.beginToolCall(currentGrant.grantId);
      try {
        return await operation(args, currentGrant);
      } finally {
        grants.endToolCall(currentGrant.grantId);
      }
    });
  };
  if (grant.catalogTools.includes(AGENT_SERVER_MEMORY_READ_TOOL_REF)) {
    register(
      AGENT_SERVER_MEMORY_READ_TOOL_REF,
      AGENT_SERVER_MEMORY_READ_MCP_NAME,
      {
        description: 'Read one authorized Memory by normalized path.',
        inputSchema: memoryReadInput,
        annotations: { readOnlyHint: true },
        _meta: { risk: 'read_only' },
      },
      async (args, currentGrant) => readMemory(args, currentGrant, repository),
    );
  }
  const market = input.market ?? new SyntheticMarketAdapter();
  if (
    grant.catalogTools.includes(AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF)
  )
    register(
      AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
      'synthetic_stock_snapshot',
      {
        description: 'Read the fixed synthetic ACME snapshot.',
        inputSchema: fixtureInput,
      },
      (args) =>
        loggedSynthetic(
          'synthetic_stock_snapshot',
          () => market.stockSnapshot(args),
          input.logger,
        ),
    );
  if (grant.catalogTools.includes(AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF))
    register(
      AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
      'synthetic_event_batch',
      {
        description: 'Read the fixed synthetic ACME event batch.',
        inputSchema: fixtureInput,
      },
      (args) =>
        loggedSynthetic(
          'synthetic_event_batch',
          () => market.eventBatch(args),
          input.logger,
        ),
    );
  if (
    grant.catalogTools.includes(AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF)
  )
    register(
      AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
      'synthetic_analog_summary',
      {
        description: 'Read the fixed synthetic ACME analog summary.',
        inputSchema: fixtureInput,
      },
      (args) =>
        loggedSynthetic(
          'synthetic_analog_summary',
          () => market.analogSummary(args),
          input.logger,
        ),
    );
  if (
    grant.catalogTools.includes(
      AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
    ) &&
    input.createLearningProposal
  )
    register(
      AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
      'learning_proposal_create',
      {
        description: 'Create a human-reviewed learning proposal.',
        inputSchema: proposalInput.shape,
      },
      (args, currentGrant) =>
        createProposal(
          args,
          currentGrant,
          repository,
          input.createLearningProposal!,
          input.teamTools,
        ),
    );
  return new Map();
}

async function readMemory(
  args: { readonly memory_store_id: string; readonly path: string },
  grant: RuntimeToolGrant,
  repository: MemoryApiRepository,
) {
  let path: string;
  try {
    path = normalizeMemoryPath(args.path);
  } catch {
    return notFound();
  }
  const principal = {
    tenantId: grant.tenantId,
    principalType: grant.principalType,
    principalId: grant.principalId,
  };
  let store;
  let memories;
  try {
    store = await repository.getStore(args.memory_store_id, principal);
    if (!store || store.owner.workspaceId !== grant.workspaceId)
      return notFound();
    memories = await repository.listMemories(args.memory_store_id, principal);
  } catch {
    return internalError();
  }
  const memory = memories?.find((candidate) => candidate.path === path);
  if (!memory) return notFound();
  const result = {
    memory_id: memory.id,
    memory_version_id: memory.current.id,
    version: memory.current.version,
    path: memory.path,
    content_sha256: memory.current.contentSha256,
    content: memory.current.content,
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function loggedSynthetic<T>(
  toolName: string,
  operation: () => T,
  logger?: Logger,
) {
  const startedAt = Date.now();
  logger?.log('info', 'runtime.mcp.tool.started', { tool_name: toolName });
  const result = safeSynthetic(operation);
  const outcome =
    result.structuredContent &&
    typeof result.structuredContent === 'object' &&
    'error' in result.structuredContent &&
    result.structuredContent.error === 'invalid_request'
      ? 'invalid_request'
      : 'success';
  logger?.log('info', 'runtime.mcp.tool.completed', {
    tool_name: toolName,
    elapsed_ms: Date.now() - startedAt,
    outcome,
  });
  return result;
}

function safeSynthetic<T>(operation: () => T) {
  try {
    const value = operation();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value) }],
      structuredContent: value as Record<string, unknown>,
    };
  } catch {
    return invalidRequest();
  }
}

async function createProposal(
  args: {
    memory_store_id: string;
    target_path: string;
    proposed_content: string;
    evidence_refs: string[];
  },
  grant: RuntimeToolGrant,
  repository: MemoryApiRepository,
  create: CreateLearningProposal,
  teamTools?: { contextResolver: TeamToolContextResolver },
) {
  if (!grant.taskId || !grant.runId || !grant.teamMemberRunId || !teamTools)
    return notFound();
  const owner = {
    tenantId: grant.tenantId,
    workspaceId: grant.workspaceId,
    principalType: grant.principalType,
    principalId: grant.principalId,
  };
  try {
    const actor = await teamTools.contextResolver.resolve(grant);
    const store = await repository.getStore(args.memory_store_id, owner);
    if (!store || store.owner.workspaceId !== grant.workspaceId)
      return notFound();
    const memories = await repository.listMemories(args.memory_store_id, owner);
    const memory = memories?.find(
      (candidate) => candidate.path === normalizeMemoryPath(args.target_path),
    );
    if (!memory) return notFound();
    const proposal = await create.execute({
      sourceTeamRunId: actor.teamRun.id,
      sourceTaskId: grant.taskId,
      sourceRunId: grant.runId,
      targetMemoryStoreId: args.memory_store_id,
      targetMemoryId: memory.id,
      targetPath: memory.path,
      baseContentSha256: memory.current.contentSha256,
      proposedContent: args.proposed_content,
      evidenceRefs: args.evidence_refs,
      accessContext: {
        ...owner,
        policySnapshotVersion: 'runtime',
      } as AccessContext,
    });
    return proposal ? success(toMcpProposalProjection(proposal)) : notFound();
  } catch (error) {
    if (
      error instanceof Error &&
      /invalid|normalized|exceeds|evidence/i.test(error.message)
    )
      return invalidRequest();
    return internalError();
  }
}

function toMcpProposalProjection(proposal: LearningProposal) {
  return {
    learning_proposal_id: proposal.id,
    status: proposal.status,
    source: {
      team_run_id: proposal.sourceTeamRunId,
      task_id: proposal.sourceTaskId,
      run_id: proposal.sourceRunId,
    },
    target: {
      memory_store_id: proposal.targetMemoryStoreId,
      memory_id: proposal.targetMemoryId,
      path: proposal.targetPath,
      base_content_sha256: proposal.baseContentSha256,
    },
    evidence_refs: proposal.evidenceRefs,
    created_at: proposal.createdAt,
  };
}

function success(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function invalidRequest() {
  const result = { error: 'invalid_request' as const };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function notFound() {
  const result = { error: 'not_found' as const };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function internalError() {
  const result = { error: 'internal_error' as const };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function authenticate(
  req: IncomingMessage,
  grants: RuntimeToolGrantService,
): RuntimeToolGrant | null {
  const value = req.headers.authorization;
  if (!value || !/^Bearer\s+[^\s]+$/i.test(value)) return null;
  return grants.resolve(value.slice(value.indexOf(' ') + 1).trim());
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('request too large') as Error & {
          code: string;
        };
        error.code = 'request_too_large';
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid request'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
