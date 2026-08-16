import type { AccessContext } from '../../platform/access-context.js';
import type { ResolvedWorkDefinition } from '../../domain/work/work-composition.js';

export interface ResolveWorkDefinitionInput {
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly accessContext: AccessContext;
}

/**
 * Product Work depends on this resolved boundary rather than on Team-specific
 * registry shapes. Implementations must resolve only immutable published
 * resources and must not cause runtime side effects.
 */
export interface WorkDefinitionResolutionPort {
  resolve(input: ResolveWorkDefinitionInput): Promise<ResolvedWorkDefinition>;
}
