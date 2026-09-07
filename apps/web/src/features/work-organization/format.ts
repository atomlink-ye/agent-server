import type { WorkItemStatus } from '@atomlink-ye/agent-server/product-contract';

export const STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

/**
 * A linked Work's product state, in the words the Work surface uses. The DTO
 * value stays the canonical English enum; only the label is localized.
 */
export const PRODUCT_STATE_LABELS: Record<string, string> = {
  running: 'Running',
  needs_you: 'Needs You',
  complete: 'Complete',
  problem: 'Problem',
  not_captured: 'State unavailable',
};

export function productStateLabel(state: string): string {
  return PRODUCT_STATE_LABELS[state] ?? state;
}

/** A Coworker's reachability, in the words a reader understands. */
export const RUNTIME_STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  draining: 'Draining',
  unavailable: 'Unavailable',
};

export function runtimeStatusLabel(status: string): string {
  return RUNTIME_STATUS_LABELS[status] ?? status;
}

/** What a Coworker without a declared role is called on screen. */
export const COWORKER_ROLE_FALLBACK = 'AI Coworker';

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
