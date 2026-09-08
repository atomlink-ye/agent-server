import type { Coworker } from './contracts';
import type { Translate } from '../../i18n';

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

/**
 * The API's runtime status is a closed vocabulary. Keep its UI mapping total:
 * a new status must add a translation instead of silently becoming offline.
 */
export function runtimeStatusLabel(
  t: Translate,
  status: Coworker['runtimeStatus'],
): string {
  const key: Record<Coworker['runtimeStatus'], Parameters<Translate>[0]> = {
    working: 'runtimeStatus.working',
    thinking: 'runtimeStatus.thinking',
    available: 'runtimeStatus.available',
    draining: 'runtimeStatus.draining',
    unavailable: 'runtimeStatus.unavailable',
  };
  return t(key[status]);
}

export const BUSY_RUNTIME_STATUSES: ReadonlySet<Coworker['runtimeStatus']> =
  new Set(['working', 'thinking']);

export const BUSY_CHAT_HINT =
  'This Coworker is handling another conversation right now. Try again once it finishes.';

/** Chat needs an idle runtime, so every other status blocks the button. */
export function chatBlocked(status: Coworker['runtimeStatus']): boolean {
  return status !== 'available';
}
