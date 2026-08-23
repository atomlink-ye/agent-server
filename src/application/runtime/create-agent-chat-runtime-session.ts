import type {
  ResolveRuntimeSessionSpec,
  RuntimeSessionSpecConfiguration,
} from '../ports/resolve-runtime-session-spec.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import type { ResourceOwner } from '../../domain/tenancy/product-context.js';
import type { DesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';

export interface CreateAgentChatRuntimeSession {
  execute(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly agentOwner: ResourceOwner;
    readonly agentVersionId: string;
    readonly resolvedSkills: readonly {
      readonly ref: string;
      readonly digest: string;
    }[];
    readonly toolRefs: readonly string[];
    readonly desiredSystemPrompt: DesiredRuntimeSystemPrompt;
  }): Promise<RuntimeSession>;
}

/** Creates the stable RuntimeSession identity for one agent-chat runtime epoch. */
export class AgentChatRuntimeSessionCreator implements CreateAgentChatRuntimeSession {
  public constructor(
    private readonly sessions: RuntimeSessionStore,
    private readonly resolveSpec: ResolveRuntimeSessionSpec,
    private readonly configuration: Omit<
      RuntimeSessionSpecConfiguration,
      'contextEpoch' | 'desiredSystemPrompt'
    >,
  ) {}

  public async execute(
    input: Parameters<CreateAgentChatRuntimeSession['execute']>[0],
  ): Promise<RuntimeSession> {
    const owner = {
      tenantId: input.agentOwner.scope.tenantId,
      workspaceId: input.agentOwner.scope.workspaceId,
      principalType: input.agentOwner.principal.type,
      principalId: input.agentOwner.principal.id,
    } as const;
    const scope = {
      kind: 'agent_chat' as const,
      id: input.agentChatRuntimeId,
      epoch: input.runtimeEpoch,
    };
    const existing = await this.sessions.findByScope(owner, scope);
    if (existing) return existing;

    const spec = this.resolveSpec.execute({
      owner,
      agentVersionId: input.agentVersionId,
      environmentVersionId: null,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      configuration: {
        ...this.configuration,
        contextEpoch: input.runtimeEpoch,
        desiredSystemPrompt: input.desiredSystemPrompt,
      },
    });
    return this.sessions.createWithInitialSpec({ owner, scope, spec });
  }
}
