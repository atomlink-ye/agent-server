import type { ModelPolicyRef } from '../../domain/agents/managed-agent-package.js';
import type { InvokableOwnerScope } from '../../domain/invokables/invokable.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';

export type AgentVersionResolutionScope = InvokableOwnerScope;

export type ResolvedAgentVersion = Readonly<{
  readonly source: 'managed' | 'legacy';
  readonly id: string;
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
