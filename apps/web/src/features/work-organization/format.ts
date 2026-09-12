import type { WorkItemStatus } from '@atomlink-ye/agent-server/product-contract';

import { t } from '../../i18n';

/**
 * The label tables read the current locale at call time, so each one is a
 * function rather than a frozen constant. `t()` does not subscribe to anything;
 * `App` re-renders the tree on a language switch, which is what carries a new
 * language down to callers that are not themselves translation-aware.
 */
export function statusLabels(): Record<WorkItemStatus, string> {
  return {
    todo: t('workItem.status.todo'),
    in_progress: t('workItem.status.in_progress'),
    in_review: t('workItem.status.in_review'),
    done: t('workItem.status.done'),
  };
}

/** Every WorkItem status, in the fixed order the filters and pickers use. */
export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  'todo',
  'in_progress',
  'in_review',
  'done',
];

export function statusLabel(status: WorkItemStatus): string {
  return statusLabels()[status];
}

/**
 * A linked Work's product state, in the words the Work surface uses. The DTO
 * value stays the canonical English enum; only the label is localized.
 */
export function productStateLabel(state: string): string {
  switch (state) {
    case 'running':
      return t('work.latestState', { state: t('productState.running.label') });
    case 'needs_you':
      return t('work.latestState', {
        state: t('productState.needs_you.label'),
      });
    case 'complete':
      return t('work.latestState', { state: t('productState.complete.label') });
    case 'problem':
      return t('work.latestState', { state: t('productState.problem.label') });
    case 'not_captured':
      return t('work.latestState', {
        state: t('productState.not_captured.label'),
      });
    default:
      return state;
  }
}

/** A Coworker's reachability, in the words a reader understands. */
export function runtimeStatusLabel(status: string): string {
  switch (status) {
    case 'available':
      return t('runtimeStatus.available');
    case 'working':
      return t('runtimeStatus.working');
    case 'thinking':
      return t('runtimeStatus.thinking');
    case 'draining':
      return t('runtimeStatus.draining');
    case 'unavailable':
      return t('runtimeStatus.unavailable');
    default:
      return status;
  }
}

/** What a Coworker without a declared role is called on screen. */
export function coworkerRoleFallback(): string {
  return t('coworker.role.fallback');
}

/**
 * Timestamps read the way `ConversationsList` already formats them — time of
 * day for today, month and day before that — so Tasks, Boards, and the chat
 * list agree on what a timestamp looks like.
 */
export function formatWorkTime(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * A one-line preview of a card's description. Cumora clamps the preview in
 * CSS; a card also has to survive a description with no line breaks, so the
 * text is collapsed first and the clamp stays in CSS.
 */
export function descriptionPreview(
  description: string | null,
  limit = 160,
): string | null {
  const collapsed = (description ?? '').replace(/\s+/gu, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1).trimEnd()}…`
    : collapsed;
}
