import {
  decideLoopCap,
  DEFAULT_LOOP_HARD_CAP,
  type LoopCapOptions,
} from '../coordination/loop-cap-guard.js';

/**
 * Deterministic cross-turn loop breaker for WorkItem mention wakes.
 *
 * `wakeMentionedAgents` decides whether a mention should trigger a chat turn at
 * all — it never decides who replies or how. This module answers one further
 * question at the same chokepoint: has this WorkItem been mutually re-waking
 * Coworkers so many times in a row, with no human back in the loop, that
 * another wake would only feed a runaway rather than real work?
 *
 * The cap comparison itself is generic (see coordination/loop-cap-guard.ts,
 * shared with the unrelated Team collaboration maxLeadTurns backstop); what is
 * specific here is WHAT counts as the count (agent-caused wakes) and WHAT
 * resets it (a human-caused wake) for this one pipeline. Kept pure and
 * side-effect free — mirrors ChatDeliveryRetryPolicy — so the cap and the
 * reset boundary are directly assertable without a database. The durable
 * counter that feeds it lives behind WakeLoopGuardRepository.
 */

/**
 * Matches Cumora's HARD_LOOP_CAP: a fixed backstop set high enough that a
 * legitimate multi-round exchange almost always finishes, or draws a human
 * back in, before it fires.
 */
export const DEFAULT_WAKE_LOOP_HARD_CAP = DEFAULT_LOOP_HARD_CAP;

export interface WakeLoopGuardState {
  /** Agent-caused wake events observed on this WorkItem since a human last caused one. */
  readonly agentWakeCount: number;
}

export type WakeLoopGuardDecision =
  | { readonly kind: 'allow' }
  | {
      readonly kind: 'block';
      readonly reason: 'hard_loop_cap';
      readonly agentWakeCount: number;
      readonly hardCap: number;
    };

export type WakeLoopGuardOptions = LoopCapOptions;

export function decideWakeLoopGuard(
  state: WakeLoopGuardState,
  options: WakeLoopGuardOptions = {},
): WakeLoopGuardDecision {
  const decision = decideLoopCap({ count: state.agentWakeCount }, options);
  if (decision.kind === 'allow') return decision;
  return {
    kind: 'block',
    reason: decision.reason,
    agentWakeCount: decision.count,
    hardCap: decision.hardCap,
  };
}

export interface WakeLoopGuardKey {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workItemId: string;
}

export interface WakeLoopGuardRepository {
  /**
   * Atomically advances the per-WorkItem mutual-wake counter and returns the
   * state after this observation: a human-caused wake resets the count to
   * zero (fresh human intent breaks any loop), an agent-caused wake
   * increments it.
   */
  observeWake(
    input: WakeLoopGuardKey & { readonly causedByHuman: boolean },
  ): Promise<WakeLoopGuardState>;
}
