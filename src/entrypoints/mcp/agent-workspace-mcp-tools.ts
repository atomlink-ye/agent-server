import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  InvalidAgentHomeContentError,
  InvalidAgentHomePathError,
  type AgentHomeAccessContext,
  ListAgentHomeEntries,
  ReadAgentHomeEntry,
  WriteAgentHomeEntry,
} from '../../application/agents/agent-home.js';
import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import type { ConversationAgentIdentityResolver } from '../../application/work-organization/conversation-agent-identity.js';
import {
  AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
  AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
  AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
} from '../../application/agents/built-in-skills.js';

const workspaceListInput = z.strictObject({});
const workspaceReadInput = z.strictObject({
  path: z.string(),
});
const workspaceWriteInput = z.strictObject({
  path: z.string(),
  content: z.string(),
});

type WorkspaceReadInput = z.infer<typeof workspaceReadInput>;
type WorkspaceWriteInput = z.infer<typeof workspaceWriteInput>;

type AgentHomeUseCases = Readonly<{
  readonly list: Pick<ListAgentHomeEntries, 'execute'>;
  readonly read: Pick<ReadAgentHomeEntry, 'execute'>;
  readonly write: Pick<WriteAgentHomeEntry, 'execute'>;
}>;

export interface AgentWorkspaceMcpDependencies {
  readonly server: McpServer;
  readonly grant: AuthorizedRuntimeToolContext;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly agentHome: AgentHomeUseCases;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}

/**
 * Coworker workspace files. The caller supplies no identity or scope: every
 * operation derives both from the current Chat turn and its Conversation.
 */
export function registerAgentWorkspaceMcpTools(
  input: AgentWorkspaceMcpDependencies,
): void {
  if (input.grant.catalogTools.includes(AGENT_SERVER_WORKSPACE_LIST_TOOL_REF))
    registerListTool(input);
  if (input.grant.catalogTools.includes(AGENT_SERVER_WORKSPACE_READ_TOOL_REF))
    registerReadTool(input);
  if (input.grant.catalogTools.includes(AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF))
    registerWriteTool(input);
}

function registerListTool(input: AgentWorkspaceMcpDependencies): void {
  (input.server.registerTool as any)(
    'workspace_list',
    {
      description:
        'List your Coworker durable workspace files visible in Shared Coworker files. Returns metadata only; use workspace_read for content.',
      inputSchema: workspaceListInput,
      annotations: { readOnlyHint: true },
      _meta: { risk: 'read_only' },
    },
    async (args: unknown) => {
      const current = await input.authorize(
        AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
      );
      if (!current) return toolError('not_found');
      if (!workspaceListInput.safeParse(args).success)
        return toolError('invalid_request');
      const agentDefinitionId = await resolveAgentIdentity(
        current,
        input.agentIdentities,
      );
      if (!agentDefinitionId) return toolError('not_found');

      try {
        const entries = await input.agentHome.list.execute({
          accessContext: accessContext(current),
          agentDefinitionId,
          namespace: 'agent-shared',
          scopeParams: { workspaceId: current.workspaceId },
        });
        if (!entries) return toolError('not_found');
        return success({ entries: entries.map(toMetadata) });
      } catch (error) {
        return agentHomeError(error, 'workspace_list_failed');
      }
    },
  );
}

function registerReadTool(input: AgentWorkspaceMcpDependencies): void {
  (input.server.registerTool as any)(
    'workspace_read',
    {
      description:
        'Read one file from your Coworker durable workspace files visible in Shared Coworker files.',
      inputSchema: workspaceReadInput,
      annotations: { readOnlyHint: true },
      _meta: { risk: 'read_only' },
    },
    async (args: WorkspaceReadInput) => {
      const current = await input.authorize(
        AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
      );
      if (!current) return toolError('not_found');
      const parsed = workspaceReadInput.safeParse(args);
      if (!parsed.success) return toolError('invalid_request');
      const agentDefinitionId = await resolveAgentIdentity(
        current,
        input.agentIdentities,
      );
      if (!agentDefinitionId) return toolError('not_found');

      try {
        const entry = await input.agentHome.read.execute({
          accessContext: accessContext(current),
          agentDefinitionId,
          namespace: 'agent-shared',
          scopeParams: { workspaceId: current.workspaceId },
          path: parsed.data.path,
        });
        if (!entry) return toolError('not_found');
        return success({ ...toMetadata(entry), content: entry.content });
      } catch (error) {
        return agentHomeError(error, 'workspace_read_failed');
      }
    },
  );
}

function registerWriteTool(input: AgentWorkspaceMcpDependencies): void {
  (input.server.registerTool as any)(
    'workspace_write',
    {
      description:
        'Write one file to your Coworker durable workspace files visible in Shared Coworker files.',
      inputSchema: workspaceWriteInput,
    },
    async (args: WorkspaceWriteInput) => {
      const current = await input.authorize(
        AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
      );
      if (!current) return toolError('not_found');
      const parsed = workspaceWriteInput.safeParse(args);
      if (!parsed.success) return toolError('invalid_request');
      const agentDefinitionId = await resolveAgentIdentity(
        current,
        input.agentIdentities,
      );
      if (!agentDefinitionId) return toolError('not_found');

      try {
        const entry = await input.agentHome.write.execute({
          accessContext: accessContext(current),
          agentDefinitionId,
          namespace: 'agent-shared',
          scopeParams: { workspaceId: current.workspaceId },
          path: parsed.data.path,
          content: parsed.data.content,
        });
        if (!entry) return toolError('not_found');
        return success(toMetadata(entry));
      } catch (error) {
        return agentHomeError(error, 'workspace_write_failed');
      }
    },
  );
}

async function resolveAgentIdentity(
  current: AuthorizedRuntimeToolContext,
  agentIdentities: ConversationAgentIdentityResolver,
): Promise<string | null> {
  if (!current.chatContext) return null;
  try {
    return await agentIdentities.resolve({
      tenantId: current.tenantId,
      conversationId: current.chatContext.conversationId,
    });
  } catch {
    // Identity lookup failures fail closed and never expose database details.
    return null;
  }
}

function accessContext(
  current: AuthorizedRuntimeToolContext,
): AgentHomeAccessContext {
  return {
    tenantId: current.tenantId,
    workspaceId: current.workspaceId,
    principalType: current.principalType,
    principalId: current.principalId,
  };
}

function toMetadata(entry: {
  readonly id: string;
  readonly path: string;
  readonly currentVersion: number;
  readonly contentSha256: string;
  readonly contentSizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}) {
  return {
    id: entry.id,
    path: entry.path,
    current_version: entry.currentVersion,
    content_sha256: entry.contentSha256,
    content_size_bytes: entry.contentSizeBytes,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function agentHomeError(error: unknown, fallback: string) {
  if (
    error instanceof InvalidAgentHomePathError ||
    error instanceof InvalidAgentHomeContentError
  )
    return toolError('invalid_request');
  return toolError(fallback);
}

function success(value: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function toolError(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}
