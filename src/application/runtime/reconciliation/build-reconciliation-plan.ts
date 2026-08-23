import type { RuntimeSessionGeneration } from '../../../domain/runtime/runtime-session-generation.js';
import type { RuntimeSessionSpec } from '../../../domain/runtime/runtime-session-spec.js';
import type {
  ReconciliationPlan,
  RuntimeSpecField,
} from '../../../domain/runtime/reconciliation-plan.js';
import type { RuntimeProviderCapabilities } from '../../../domain/runtime/runtime-provider-capabilities.js';
import { compareRuntimeSpecs } from './compare-runtime-spec.js';
import type { RuntimeSpecDiff } from './compare-runtime-spec.js';

export interface BuildReconciliationPlanInput {
  readonly applied: RuntimeSessionSpec;
  readonly desired: RuntimeSessionSpec;
  readonly generation: RuntimeSessionGeneration | null;
  readonly providerCapabilities: RuntimeProviderCapabilities;
}

/**
 * Decides how a desired spec is reconciled with its current generation.
 * This function deliberately has no provider, persistence, clock, or logging
 * dependencies; execution belongs to the runtime generation manager.
 */
export function buildReconciliationPlan({
  applied,
  desired,
  generation,
  providerCapabilities,
}: BuildReconciliationPlanInput): ReconciliationPlan {
  if (!generation) return { kind: 'create' };

  const diff = compareRuntimeSpecs(applied, desired);

  // A generation/provider binding disagreement is a stale provider identity,
  // even when the two persisted specs happen to compare equal.
  if (
    applied.provider !== desired.provider ||
    generation.provider !== desired.provider
  )
    return {
      kind: 'replace',
      generationId: generation.id,
      reason: 'provider_changed',
    };

  if (diff.replacementRequired.length > 0)
    return replacementPlan(generation, 'immutable_spec_changed');

  if (diff.mutableInPlace.length === 0)
    return { kind: 'reuse', generationId: generation.id };

  if (providerCapabilities.canReconfigure)
    return {
      kind: 'reconfigure',
      generationId: generation.id,
      changed: diff.mutableInPlace,
    };

  // Named deferral: when any provider canReconfigure returns true, implement GenerationManager.reconfigure(), preserving §11.1 generation id/number/provider session id invariants.
  return replacementPlan(generation, 'provider_cannot_reconfigure');
}

function replacementPlan(
  generation: RuntimeSessionGeneration,
  reason: Extract<ReconciliationPlan, { readonly kind: 'replace' }>['reason'],
): ReconciliationPlan {
  return {
    kind: 'replace',
    generationId: generation.id,
    reason,
  };
}

export type {
  ReconciliationPlan,
  RuntimeSpecField,
} from '../../../domain/runtime/reconciliation-plan.js';
export type { RuntimeSpecDiff } from './compare-runtime-spec.js';
