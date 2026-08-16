import type { AccessContext } from '../../platform/access-context.js';
import type { ResolvedWorkDefinition } from '../../domain/work/work-composition.js';

export interface ResolveWorkDefinitionInput {
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly accessContext: AccessContext;
}

/**
 * Side-effect-free composition boundary used before WorkRun execution admission.
 * Implementations resolve only immutable/published resources and never invoke
 * the Execution Plane.
 */
export interface WorkDefinitionResolutionPort {
  resolve(input: ResolveWorkDefinitionInput): Promise<ResolvedWorkDefinition>;
}
