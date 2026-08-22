import type {
  LatestWorkRunSummary,
  ProductWorkRunDetail,
  WorkListItem,
} from '@atomlink-ye/agent-server/product-contract';

export type WorkTab =
  'overview' | 'runs' | 'transcript' | 'artifacts' | 'definition';

export const WORK_TABS: readonly {
  readonly id: WorkTab;
  readonly label: string;
}[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'definition', label: 'Definition' },
];

export function normalizeWorkTab(value: string | undefined): WorkTab {
  return WORK_TABS.some((tab) => tab.id === value)
    ? (value as WorkTab)
    : 'overview';
}

export function workTabHref(workId: string, tab: WorkTab, runId?: string) {
  const query = new URLSearchParams();
  if (tab !== 'overview') query.set('tab', tab);
  if (runId) query.set('run', runId);
  const encodedWorkId = encodeURIComponent(workId);
  const suffix = query.toString();
  return `/work/${encodedWorkId}${suffix ? `?${suffix}` : ''}`;
}

export function productStatePresentation(state: WorkListItem['product_state']) {
  switch (state) {
    case 'running':
      return { label: 'Running', description: 'The latest Run is active.' };
    case 'needs_you':
      return {
        label: 'Needs You',
        description: 'Your action is required before Work can safely progress.',
      };
    case 'complete':
      return {
        label: 'Complete',
        description: 'The latest Run reached a completed product state.',
      };
    case 'problem':
      return {
        label: 'Problem',
        description: 'The latest Run needs review before Work can progress.',
      };
    case 'not_captured':
      return {
        label: 'State unavailable',
        description: 'Product state was not captured.',
      };
  }
}

export function latestRunSummary(work: WorkListItem) {
  const latest = work.latest_run_summary;
  if (!latest) return 'No Run has been recorded yet.';
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
      return 'Result summary captured.';
    case 'redacted':
      return 'Result was captured but is redacted.';
    case 'not_present':
      return 'No result summary is present.';
    case 'not_captured':
      return 'Result capture is unavailable.';
  }
}

export function formatTimestamp(value: string) {
  return `${value.replace('T', ' ').slice(0, 16)} UTC`;
}

export function humanize(value: string) {
  return value.replaceAll('_', ' ');
}
