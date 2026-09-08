import type {
  LatestWorkRunSummary,
  ProductWorkRunDetail,
  WorkListItem,
} from '@atomlink-ye/agent-server/product-contract';
import { workTabPath } from '../../../app/routes';

export type WorkTab =
  'overview' | 'runs' | 'transcript' | 'artifacts' | 'definition';

export const WORK_TABS: readonly {
  readonly id: WorkTab;
  readonly label: string;
}[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'transcript', label: 'Conversation' },
  { id: 'artifacts', label: 'Files' },
  { id: 'definition', label: 'Definition' },
];

export function normalizeWorkTab(value: string | undefined): WorkTab {
  return value === 'overview' || WORK_TABS.some((tab) => tab.id === value)
    ? (value as WorkTab)
    : 'overview';
}

export function workTabHref(
  workId: string,
  tab: WorkTab,
  runId?: string,
  originConversationId?: string | null,
) {
  return workTabPath(workId, tab, runId ?? null, originConversationId ?? null);
}

/**
 * Every stage a Work Card or a Run row can be in. The two Work-level stages a
 * Run state cannot express are named here so no surface has to invent a label
 * for them.
 */
export type WorkStage =
  WorkListItem['product_state'] | 'not_started' | 'starting';

export function productStatePresentation(state: WorkStage) {
  switch (state) {
    case 'not_started':
      return {
        label: 'Ready to start',
        // A Work that has just been created has not failed at anything. The
        // honest line names the next move, not a missing result.
        description:
          'This Work is set up and hasn’t run yet. Open it to start the first Run.',
      };
    case 'starting':
      return {
        label: 'Starting',
        description: 'This Run has been requested and is starting.',
      };
    case 'running':
      return { label: 'Running', description: 'This Run is active.' };
    case 'needs_you':
      return {
        label: 'Needs You',
        description: 'Your action is required before this Work can progress.',
      };
    case 'complete':
      return {
        label: 'Complete',
        description: 'This Run is complete. Open its result to review.',
      };
    case 'problem':
      return {
        label: 'Problem',
        description: 'This Run needs review before Work can progress.',
      };
    case 'not_captured':
      return {
        label: 'Status unknown',
        description: 'We don’t have a status update for this Work.',
      };
  }
}

export function latestRunSummary(work: WorkListItem) {
  const latest = work.latest_run_summary;
  if (!latest) return 'No runs yet.';
  if (latest.result_summary !== null) return latest.result_summary;
  return resultCaptureLabel(latest.result_capture_status);
}

export function resultCaptureLabel(
  status:
    | LatestWorkRunSummary['result_capture_status']
    | ProductWorkRunDetail['result_capture_status'],
): string {
  switch (status) {
    case 'present':
      return 'Result summary is ready.';
    case 'redacted':
      return 'A result is available, but its summary is redacted.';
    case 'not_present':
      return 'This Run has no result summary.';
    case 'not_captured':
      return 'The result summary is still unavailable.';
  }
}

export function formatTimestamp(value: string) {
  return `${value.replace('T', ' ').slice(0, 16)} UTC`;
}

/** A compact, locale-aware timestamp for the navigation index. */
export function formatWorkListTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Updated time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function humanize(value: string) {
  return value.replaceAll('_', ' ');
}
