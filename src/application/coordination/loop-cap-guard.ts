/**
 * Generic deterministic "how many times in a row, capped" loop breaker.
 *
 * Two independent pipelines in this codebase each answer their own version of
 * "when should a self-perpetuating chain of turns stop": the WorkItem
 * mention-wake path (see application/work-organization/wake-loop-guard.ts)
 * counts agent-caused wakes per WorkItem, and the Team collaboration path (see
 * domain/collaboration/collaboration-policy-definition.ts's maxLeadTurns)
 * counts Lead re-activations per TeamRun. Both answers boil down to the same
 * comparison — a monotonic count against a fixed cap — so that comparison
 * lives here, once. WHAT increments the count and WHAT resets it (an actor's
 * principal type in one pipeline, a completion-rejection baseline in the
 * other) is genuinely different per pipeline and stays with each caller: this
 * module takes no opinion on storage or on what is being counted.
 */

export const DEFAULT_LOOP_HARD_CAP = 20;

export interface LoopCapState {
  readonly count: number;
}

export type LoopCapDecision =
  | { readonly kind: 'allow' }
  | {
      readonly kind: 'block';
      readonly reason: 'hard_loop_cap';
      readonly count: number;
      readonly hardCap: number;
    };

export interface LoopCapOptions {
  readonly hardCap?: number;
}

export function decideLoopCap(
  state: LoopCapState,
  options: LoopCapOptions = {},
): LoopCapDecision {
  const hardCap = options.hardCap ?? DEFAULT_LOOP_HARD_CAP;
  if (state.count > hardCap) {
    return {
      kind: 'block',
      reason: 'hard_loop_cap',
      count: state.count,
      hardCap,
    };
  }
  return { kind: 'allow' };
}
