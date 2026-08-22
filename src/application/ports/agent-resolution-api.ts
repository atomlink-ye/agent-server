import type { ModelPolicyRef } from '../../domain/agents/managed-agent-package.js';
import type { InvokableOwnerScope } from '../../domain/invokables/invokable.js';
import type { ResourceOwner } from '../../domain/tenancy/product-context.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';

export type AgentVersionResolutionScope = InvokableOwnerScope;

export type ResolvedAgentVersion = Readonly<{
  readonly source: 'managed' | 'legacy';
  readonly id: string;
  /** Canonical Agent identity; optional only for compatibility test/runtime shims. */
  readonly definitionId?: string;
  /** Agent resource owner; distinct from the actor executing this turn. */
  readonly agentOwner?: ResourceOwner;
  readonly instructions: string;
  readonly modelPolicyRef: ModelPolicyRef;
  readonly proposalLimit?: number;
  readonly skills: readonly ResolvedSkillPackage[];
  readonly toolRefs: readonly string[];
}>;

export interface AgentResolutionApi {
  resolvePublished(
    versionId: string,
    scope: AgentVersionResolutionScope,
    options?: { readonly resolveExtensions?: boolean },
  ): Promise<ResolvedAgentVersion | null>;
}
