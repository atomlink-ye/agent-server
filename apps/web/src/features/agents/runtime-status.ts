import type { Coworker } from './contracts';

/**
 * Cumora shows four status chips (working/thinking/available/resting) and
 * omits its rarely-set fifth state ("waiting") from that row. `draining`
 * plays the same rarely-set role here (nothing in this codebase writes it
 * today), so it keeps the same treatment: a real status, but not a filter
 * pill.
 */
export const STATUS_FILTERS: readonly Coworker['runtimeStatus'][] = [
  'working',
  'thinking',
  'available',
  'unavailable',
];

export const RUNTIME_STATUS_LABEL: Record<Coworker['runtimeStatus'], string> = {
  working: 'Working',
  thinking: 'Thinking',
  available: 'Available',
  draining: 'Draining',
  unavailable: 'Unavailable',
};

export const BUSY_RUNTIME_STATUSES: ReadonlySet<Coworker['runtimeStatus']> =
  new Set(['working', 'thinking']);

export const BUSY_CHAT_HINT =
  'This Coworker is handling another conversation right now. Try again once it finishes.';

/** Chat needs an idle runtime, so every other status blocks the button. */
export function chatBlocked(status: Coworker['runtimeStatus']): boolean {
  return status !== 'available';
}
