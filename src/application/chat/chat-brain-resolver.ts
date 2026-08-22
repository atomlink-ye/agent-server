import type { AgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import type {
  AgentHomeNamespace,
  AgentHomeScopeParams,
} from '../../domain/agents/agent-home.js';
import type { ContextView } from '../../domain/context/context-fs.js';
import type { MemoryRecord } from '../../domain/context/memory-context.js';
import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';
import {
  principalRef,
  productScope,
  resourceOwner,
  type PrincipalRef,
  type ResourceOwner,
} from '../../domain/tenancy/product-context.js';
import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import type {
  AgentHomeAccessContext,
  ListAgentHomeEntries,
} from '../agents/agent-home.js';
import { ContextViewResolver } from '../context/context-view-resolver.js';
import type { ScopedMemoryResolver } from '../context/scoped-memory-resolver.js';
import {
  createChatTurnContext,
  runtimeInvocationContextForChat,
  type ChatTurnContext,
} from './chat-turn-context.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import {
  CHAT_AGENT_HOME_NAMESPACE_ALLOWLIST,
  type ChatAgentHomeProjection,
  type ChatTurnCapabilitySummary,
} from '../ports/chat-turn-provider.js';
import type { ManagedAgentDefinitionRead } from '../ports/agent-registry.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';

const resolvedChatBrainBrand: unique symbol = Symbol('resolved_chat_brain');

export type ResolvedChatBrain = Readonly<{
  readonly [resolvedChatBrainBrand]: true;
  readonly turnContext: ChatTurnContext;
  readonly invocationContext: RuntimeInvocationContext;
  readonly agentOwner: ResourceOwner;
  /** Canonical ContextFS mount manifest for this Chat turn. */
  readonly contextView: ContextView;
  /** Canonical memories admitted by the same pure scope policy used by Workers. */
  readonly memory: readonly MemoryRecord[];
  readonly instructions: string;
  readonly capabilitySummary: ChatTurnCapabilitySummary;
  /** Compatibility prompt projection while consumers migrate to ContextFS. */
  readonly agentHome: ChatAgentHomeProjection;
  readonly resolvedSkills: readonly Pick<
    ResolvedSkillPackage,
    'ref' | 'digest'
  >[];
  readonly toolRefs: readonly string[];
}>;

export interface ChatBrainResolverInput {
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly conversationId: string;
  readonly triggerMessageId: string;
  readonly runtime: AgentChatRuntime;
  /** The principal currently talking to the Agent. This is not the Agent owner. */
  readonly actor?: PrincipalRef;
  readonly workEntitlementWorkspaceId?: string;
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
    private readonly contextViews: ContextViewResolver = new ContextViewResolver(),
    private readonly scopedMemory?: Pick<ScopedMemoryResolver, 'resolve'>,
  ) {}

  public async resolve(
    input: ChatBrainResolverInput,
  ): Promise<ResolvedChatBrain> {
    if (input.runtime.status !== 'available')
      throw new Error('chat_brain_runtime_unavailable');

    const definition =
      await this.managedDefinitions.findManagedDefinitionByTenant({
        tenantId: input.tenantId,
        definitionId: input.agentDefinitionId,
      });
    if (!definition) throw new Error('chat_brain_definition_missing');
    if (definition.tenantId !== input.tenantId)
      throw new Error('chat_brain_definition_tenant_mismatch');

    const agentOwner = resourceOwner(definition);
    const actor =
      input.actor ??
      principalRef({
        principalType: definition.principalType,
        principalId: definition.principalId,
      });

    const resolvedVersion = await this.agentResolution.resolvePublished(
      input.runtime.activeAgentVersionId,
      {
        tenantId: agentOwner.scope.tenantId,
        workspaceId: agentOwner.scope.workspaceId,
        principalType: agentOwner.principal.type,
        principalId: agentOwner.principal.id,
      },
    );
    if (!resolvedVersion || resolvedVersion.source !== 'managed')
      throw new Error('chat_brain_managed_version_unavailable');

    const accessContext: AgentHomeAccessContext = {
      tenantId: definition.tenantId,
      workspaceId: definition.workspaceId,
      principalType: actor.type,
      principalId: actor.id,
    };
    const agentHome = await this.resolveAgentHome(
      definition,
      accessContext,
      input.conversationId,
    );

    const turnContext = createChatTurnContext({
      productScope: productScope(definition),
      actor,
      agentOwner,
      conversationId: input.conversationId,
      triggerMessageId: input.triggerMessageId,
      agentDefinitionId: definition.id,
      runtime: input.runtime,
      ...(input.workEntitlementWorkspaceId
        ? { workEntitlementWorkspaceId: input.workEntitlementWorkspaceId }
        : {}),
    });
    const contextView = this.contextViews.forChat({
      productScope: turnContext.productScope,
      actor,
      agentDefinitionId: definition.id,
      conversationId: input.conversationId,
    });
    const invocationContext = Object.freeze({
      ...runtimeInvocationContextForChat(turnContext),
      contextView,
    });
    const memory = this.scopedMemory
      ? await this.scopedMemory.resolve(invocationContext)
      : Object.freeze([] as MemoryRecord[]);

    return Object.freeze({
      [resolvedChatBrainBrand]: true as const,
      turnContext,
      invocationContext,
      agentOwner,
      contextView,
      memory: Object.freeze([...memory]),
      instructions: resolvedVersion.instructions,
      capabilitySummary: Object.freeze({
        agentDefinitionId: definition.id,
        agentVersionId: input.runtime.activeAgentVersionId,
      }),
      agentHome,
      resolvedSkills: Object.freeze(
        resolvedVersion.skills.map(({ ref, digest }) => ({ ref, digest })),
      ),
      toolRefs: Object.freeze([...resolvedVersion.toolRefs]),
    });
  }

  private async resolveAgentHome(
    definition: AgentDefinition,
    accessContext: AgentHomeAccessContext,
    conversationId: string,
  ): Promise<ChatAgentHomeProjection> {
    const projection: Partial<
      Record<
        keyof ChatAgentHomeProjection,
        readonly { path: string; content: string }[]
      >
    > = {};
    for (const namespace of CHAT_AGENT_HOME_NAMESPACE_ALLOWLIST) {
      const entries = await this.listAgentHomeEntries.execute({
        accessContext,
        agentDefinitionId: definition.id,
        namespace,
        scopeParams: scopeParams(
          namespace,
          definition.workspaceId,
          conversationId,
        ),
      });
      if (entries !== null) {
        projection[namespace] = entries.map(({ path, content }) => ({
          path,
          content,
        }));
      }
    }

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
