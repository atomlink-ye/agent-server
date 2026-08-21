import type { AgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import type {
  AgentHomeAccessContext,
  ListAgentHomeEntries,
} from '../agents/agent-home.js';
import {
  CHAT_AGENT_HOME_NAMESPACE_ALLOWLIST,
  type ChatAgentHomeProjection,
  type ChatTurnCapabilitySummary,
} from '../ports/chat-turn-provider.js';
import type { ManagedAgentDefinitionRead } from '../ports/agent-registry.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';
import type { AgentHomeNamespace, AgentHomeScopeParams } from '../../domain/agents/agent-home.js';

const resolvedChatBrainBrand: unique symbol = Symbol('resolved_chat_brain');

export type ResolvedChatBrain = Readonly<{
  readonly [resolvedChatBrainBrand]: true;
  readonly instructions: string;
  readonly capabilitySummary: ChatTurnCapabilitySummary;
  readonly agentHome: ChatAgentHomeProjection;
}>;

export interface ChatBrainResolverInput {
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly conversationId: string;
  readonly runtime: AgentChatRuntime;
}

export class ChatBrainResolver {
  public constructor(
    private readonly managedDefinitions: Pick<
      ManagedAgentDefinitionRead,
      'findManagedDefinitionByTenant'
    >,
    private readonly agentResolution: AgentResolutionApi,
    private readonly listAgentHomeEntries: Pick<
      ListAgentHomeEntries,
      'execute'
    >,
  ) {}

  public async resolve(
    input: ChatBrainResolverInput,
  ): Promise<ResolvedChatBrain> {
    if (input.runtime.status !== 'available')
      throw new Error('chat_brain_runtime_unavailable');

    const definition = await this.managedDefinitions.findManagedDefinitionByTenant(
      {
        tenantId: input.tenantId,
        definitionId: input.agentDefinitionId,
      },
    );
    if (!definition) throw new Error('chat_brain_definition_missing');
    if (definition.tenantId !== input.tenantId)
      throw new Error('chat_brain_definition_tenant_mismatch');

    const resolvedVersion = await this.agentResolution.resolvePublished(
      input.runtime.activeAgentVersionId,
      {
        tenantId: definition.tenantId,
        workspaceId: definition.workspaceId,
        principalType: definition.principalType,
        principalId: definition.principalId,
      },
    );
    if (!resolvedVersion || resolvedVersion.source !== 'managed')
      throw new Error('chat_brain_managed_version_unavailable');

    const accessContext: AgentHomeAccessContext = {
      tenantId: definition.tenantId,
      workspaceId: definition.workspaceId,
      principalType: definition.principalType,
      principalId: definition.principalId,
    };
    const agentHome = await this.resolveAgentHome(
      definition,
      accessContext,
      input.conversationId,
    );

    return Object.freeze({
      [resolvedChatBrainBrand]: true as const,
      instructions: resolvedVersion.instructions,
      capabilitySummary: Object.freeze({
        agentDefinitionId: definition.id,
        agentVersionId: input.runtime.activeAgentVersionId,
      }),
      agentHome,
    });
  }

  private async resolveAgentHome(
    definition: AgentDefinition,
    accessContext: AgentHomeAccessContext,
    conversationId: string,
  ): Promise<ChatAgentHomeProjection> {
    const projection: Partial<
      Record<keyof ChatAgentHomeProjection, readonly { path: string; content: string }[]>
    > = {};
    for (const namespace of CHAT_AGENT_HOME_NAMESPACE_ALLOWLIST) {
      const entries = await this.listAgentHomeEntries.execute({
        accessContext,
        agentDefinitionId: definition.id,
        namespace,
        scopeParams: scopeParams(namespace, definition.workspaceId, conversationId),
      });
      if (entries !== null) {
        projection[namespace] = entries.map(({ path, content }) => ({
          path,
          content,
        }));
      }
    }

    // `work` needs a durable Work reference and `scratch` needs a runtime
    // session scope. A plain chat dispatch has neither, so both namespaces
    // are intentionally absent from this projection.
    return Object.freeze(projection) as ChatAgentHomeProjection;
  }
}

function scopeParams(
  namespace: AgentHomeNamespace,
  workspaceId: string,
  conversationId: string,
): AgentHomeScopeParams {
  if (namespace === 'space' || namespace === 'agent-shared')
    return { workspaceId };
  if (namespace === 'conversation') return { conversationId };
  return {};
}
