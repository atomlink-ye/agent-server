import type { RuntimeSessionGeneration } from './runtime-session-generation.js';

/** Semantic categories used by the runtime reconciliation planner. */
export type RuntimeSpecField =
  | 'workspace'
  | 'agent_version'
  | 'environment_version'
  | 'provider'
  | 'model'
  | 'cwd'
  | 'system_prompt'
  | 'skill_set'
  | 'tool_catalog'
  | 'extension_set'
  | 'context_epoch';

export type ReconciliationPlan =
  | { readonly kind: 'create' }
  | {
      readonly kind: 'reuse';
      readonly generationId: RuntimeSessionGeneration['id'];
    }
  | {
      readonly kind: 'reconfigure';
      readonly generationId: RuntimeSessionGeneration['id'];
      readonly changed: readonly RuntimeSpecField[];
    }
  | {
      readonly kind: 'replace';
      readonly generationId: RuntimeSessionGeneration['id'];
      readonly reason:
        | 'provider_missing'
        | 'provider_changed'
        | 'immutable_spec_changed'
        | 'provider_cannot_reconfigure';
    }
  | { readonly kind: 'fail'; readonly reason: 'provider_unavailable' };
