import {
  McpServer,
  type RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CollaborationKernel } from '../../application/collaboration/collaboration-kernel.js';
import type { MemoryApiRepository } from '../../application/ports/memory-api-repository.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import type { TeamCommandService } from '../../application/teams/team-command-service.js';
import { registerTeamMcpTools } from '../../adapters/team-mcp/team-mcp-tools.js';
import { registerCollaborationMcpTools } from '../../adapters/collaboration-mcp/collaboration-mcp-tools.js';
import { SyntheticMarketAdapter } from '../../adapters/demo-market/synthetic-market-adapter.js';
import { CreateLearningProposal } from '../../application/learning/learning-proposals.js';
import type { LearningProposal } from '../../domain/learning/learning-proposal.js';
import type { AccessContext } from '../../platform/access-context.js';
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
import type { RuntimeToolContributor } from '../../platform/runtime-tool-registry.js';

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

export function createMemoryReadRuntimeContributor(
  repository: MemoryApiRepository,
): RuntimeToolContributor {
  return createMemoryRuntimeContributor({ repository });
}

export function createMemoryRuntimeContributor(input: {
  readonly repository: MemoryApiRepository;
  readonly createLearningProposal?: CreateLearningProposal;
  readonly teamTools?: {
    contextResolver: TeamToolContextResolver;
  };
}): RuntimeToolContributor {
  return ({ server, grant, grants }) => {
    registerTools(server, grant, input.repository, input, grants, 'memory');
  };
}

export function createLegacyRuntimeToolsContributor(input: {
  readonly teamTools?: {
    contextResolver: TeamToolContextResolver;
    commands: TeamCommandService;
    collaboration?: CollaborationKernel;
  };
  readonly market?: SyntheticMarketAdapter;
  readonly logger?: Logger;
}): RuntimeToolContributor {
  return ({ server, grant, grants }) => {
    registerTools(server, grant, undefined, input, grants, 'legacy');
    if (
      input.teamTools?.commands &&
      grant.teamMemberRunId &&
      grant.taskId &&
      grant.runId
    ) {
      const common = {
        resolve: (currentGrant: RuntimeToolGrant) =>
          input.teamTools!.contextResolver.resolve(currentGrant),
        grantId: grant.grantId,
        currentGrant: () => grants.get(grant.grantId),
        begin: (grantId: string) => grants.beginToolCall(grantId),
        end: (grantId: string) => grants.endToolCall(grantId),
      };
      registerTeamMcpTools(
        server,
        grant.catalogTools,
        (toolRef) => grants.isToolAllowed(grant.grantId, toolRef),
        { ...common, commands: input.teamTools.commands },
      );
      if (input.teamTools.collaboration)
        registerCollaborationMcpTools(
          server,
          grant.catalogTools,
          (toolRef) => grants.isToolAllowed(grant.grantId, toolRef),
          { ...common, kernel: input.teamTools.collaboration },
        );
    }
  };
}

function registerTools(
  server: McpServer,
  grant: RuntimeToolGrant,
  repository: MemoryApiRepository | undefined,
  input: {
    readonly createLearningProposal?: CreateLearningProposal;
    readonly teamTools?: {
      contextResolver: TeamToolContextResolver;
      commands?: TeamCommandService;
      collaboration?: CollaborationKernel;
    };
    readonly market?: SyntheticMarketAdapter;
    readonly logger?: Logger;
  },
  grants: RuntimeToolGrantService,
  mode: 'memory' | 'legacy',
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
  if (
    mode === 'memory' &&
    grant.catalogTools.includes(AGENT_SERVER_MEMORY_READ_TOOL_REF)
  ) {
    register(
      AGENT_SERVER_MEMORY_READ_TOOL_REF,
      AGENT_SERVER_MEMORY_READ_MCP_NAME,
      {
        description: 'Read one authorized Memory by normalized path.',
        inputSchema: memoryReadInput,
        annotations: { readOnlyHint: true },
        _meta: { risk: 'read_only' },
      },
      async (args, currentGrant) => readMemory(args, currentGrant, repository!),
    );
  }
  if (
    mode === 'memory' &&
    grant.catalogTools.includes(
      AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
    ) &&
    input.createLearningProposal &&
    input.teamTools
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
          repository!,
          input.createLearningProposal!,
          input.teamTools,
        ),
    );
  if (mode === 'memory') return new Map();
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
  createLearningProposal: CreateLearningProposal,
  teamTools: { contextResolver: TeamToolContextResolver },
) {
  try {
    if (!grant.teamMemberRunId || !grant.taskId || !grant.runId)
      return notFound();
    const context = await teamTools.contextResolver.resolve(grant);
    const store = await repository.getStore(args.memory_store_id, context.owner);
    if (!store || store.owner.workspaceId !== context.owner.workspaceId)
      return notFound();
    const proposal = await createLearningProposal.execute({
      teamRunId: context.teamRun.id,
      teamMemberRunId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      memoryStoreId: args.memory_store_id,
      targetPath: args.target_path,
      proposedContent: args.proposed_content,
      evidenceRefs: args.evidence_refs,
      owner: context.owner,
    });
    return learningProposalResult(proposal);
  } catch {
    return internalError();
  }
}

function learningProposalResult(proposal: LearningProposal) {
  const result = {
    proposal_id: proposal.id,
    status: proposal.status,
    target_path: proposal.targetPath,
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
function notFound() {
  return { content: [{ type: 'text' as const, text: '{"error":"not_found"}' }], structuredContent: { error: 'not_found' } };
}
function internalError() {
  return { content: [{ type: 'text' as const, text: '{"error":"internal_error"}' }], structuredContent: { error: 'internal_error' } };
}
function invalidRequest() {
  return { content: [{ type: 'text' as const, text: '{"error":"invalid_request"}' }], structuredContent: { error: 'invalid_request' } };
}
