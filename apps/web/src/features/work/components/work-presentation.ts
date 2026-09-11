import type {
  LatestWorkRunSummary,
  ProductWorkRunDetail,
  WorkListItem,
} from '@atomlink-ye/agent-server/product-contract';
import { workTabPath } from '../../../app/routes';
import { getLocale, t, type Locale } from '../../../i18n';

export type WorkTab =
  | 'overview'
  | 'chat'
  | 'runs'
  | 'transcript'
  | 'artifacts'
  | 'definition'
  | 'result';

export const WORK_TABS = ['overview', 'definition'] as const;
export const RUN_TABS = ['chat', 'result', 'transcript', 'definition'] as const;

export function normalizeWorkTab(
  value: string | undefined,
  runView = false,
): WorkTab {
  if (runView) {
    if (value === 'definition') return 'definition';
    if (value === 'overview' || value === 'result') return 'result';
    return value === 'transcript' ? 'transcript' : 'chat';
  }
  if (value === 'runs') return 'overview';
  return value === 'chat' ||
    value === 'artifacts' ||
    WORK_TABS.some((tab) => tab === value)
    ? (value as WorkTab)
    : 'overview';
}

export function workTabHref(
  workId: string,
  tab: WorkTab,
  runId?: string,
  originConversationId?: string | null,
) {
  const runTab =
    RUN_TABS.some((id) => id === tab) ||
    ((tab === 'overview' || tab === 'definition') && runId);
  return workTabPath(
    workId,
    tab,
    runTab ? (runId ?? null) : null,
    originConversationId ?? null,
  );
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
        label: t('workStage.not_started.label'),
        // A Work that has just been created has not failed at anything. The
        // honest line names the next move, not a missing result.
        description: t('workStage.not_started.description'),
      };
    case 'starting':
      return {
        label: t('workStage.starting.label'),
        description: t('workStage.starting.description'),
      };
    case 'running':
      return {
        label: t('workStage.running.label'),
        description: t('workStage.running.description'),
      };
    case 'needs_you':
      return {
        label: t('workStage.needs_you.label'),
        description: t('workStage.needs_you.description'),
      };
    case 'complete':
      return {
        label: t('workStage.complete.label'),
        description: t('workStage.complete.description'),
      };
    case 'problem':
      return {
        label: t('workStage.problem.label'),
        description: t('workStage.problem.description'),
      };
    case 'not_captured':
      return {
        label: t('workStage.not_captured.label'),
        description: t('workStage.not_captured.description'),
      };
  }
}

export function latestRunSummary(work: WorkListItem) {
  const latest = work.latest_run_summary;
  if (!latest) return t('work.noRuns');
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
      return t('work.result.present');
    case 'redacted':
      return t('work.result.redacted');
    case 'not_present':
      return t('work.result.notPresent');
    case 'not_captured':
      return t('work.result.notCaptured');
  }
}

export function formatTimestamp(value: string) {
  return `${value.replace('T', ' ').slice(0, 16)} UTC`;
}

/** A compact, locale-aware timestamp for the navigation index. */
export function formatWorkListTime(
  value: string,
  locale: Locale = getLocale(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('work.updatedUnavailable');
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function humanize(value: string) {
  return value.replaceAll('_', ' ');
}
