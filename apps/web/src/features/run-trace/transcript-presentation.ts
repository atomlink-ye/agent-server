import type { TranscriptEntry } from './transcript-projection';

export type EntryPresentation = {
  readonly icon: string;
  readonly label: string;
  readonly summary: string | null;
  readonly origin: string | null;
  readonly platformToolName: string | null;
  readonly tone: 'normal' | 'failed' | 'running';
  readonly detailText: string | null;
  readonly detailKind: string | null;
  readonly exitCode: number | null;
  readonly expandable: boolean;
};

export function buildEntryPresentation(
  event: TranscriptEntry,
): EntryPresentation {
  if (event.kind === 'reasoning_progress')
    return {
      icon: 'brain',
      label: 'Thinking',
      summary: null,
      origin: null,
      platformToolName: null,
      tone: event.status === 'started' ? 'running' : 'normal',
      detailText: event.text,
      detailKind: null,
      exitCode: null,
      expandable: Boolean(event.text),
    };
  if (event.kind === 'tool_status') {
    if (event.tool_name !== null)
      return {
        icon: 'platform',
        label: humanize(event.tool_name),
        summary: null,
        origin: 'Agent Server',
        platformToolName: event.tool_name,
        tone:
          event.status === 'failed' || event.status === 'cancelled'
            ? 'failed'
            : event.status === 'running'
              ? 'running'
              : 'normal',
        detailText: null,
        detailKind: null,
        exitCode: null,
        expandable: true,
      };
    const hasToolIdentity = event.label !== null || event.tool_name !== null;
    const label = event.label ?? humanize(event.tool_name ?? event.category);
    return {
      icon: iconForTool(event.category),
      label,
      summary: meaningfulSummary(label, event.summary),
      origin: null,
      platformToolName: null,
      tone:
        event.status === 'failed' || event.status === 'cancelled'
          ? 'failed'
          : event.status === 'running'
            ? 'running'
            : 'normal',
      detailText: hasToolIdentity ? event.detail_text : null,
      detailKind: hasToolIdentity ? event.detail_kind : null,
      exitCode: hasToolIdentity ? event.exit_code : null,
      expandable:
        hasToolIdentity &&
        (Boolean(event.detail_text) || event.exit_code !== null),
    };
  }
  if (event.kind === 'child_timeline_item')
    return {
      icon: iconForTool(
        event.item_kind === 'reasoning'
          ? 'other'
          : event.item_kind === 'tool'
            ? 'other'
            : 'subagent',
      ),
      label: event.label,
      summary: meaningfulSummary(event.label, event.summary),
      origin: null,
      platformToolName: null,
      tone:
        event.status === 'failed' || event.status === 'cancelled'
          ? 'failed'
          : event.status === 'running'
            ? 'running'
            : 'normal',
      detailText: event.detail_text,
      detailKind: event.detail_kind,
      exitCode: event.exit_code,
      expandable: Boolean(event.detail_text) || event.exit_code !== null,
    };
  if (event.kind === 'permission') {
    const decision = event.decision
      ? humanize(event.decision)
      : event.status === 'resolved'
        ? 'Resolved'
        : 'Not captured / not triggered';
    return {
      icon: 'lock',
      label: 'Permission check',
      summary: `${decision}${event.summary ? ` · ${event.summary}` : ''}`,
      origin: null,
      platformToolName: null,
      tone: 'normal',
      detailText: null,
      detailKind: null,
      exitCode: null,
      expandable: false,
    };
  }
  return {
    icon: 'wrench',
    label: humanize(event.kind),
    summary: null,
    origin: null,
    platformToolName: null,
    tone: 'normal',
    detailText: null,
    detailKind: null,
    exitCode: null,
    expandable: false,
  };
}

export function humanize(value: string | null | undefined): string {
  return (
    value
      ?.replaceAll('_', ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? ''
  );
}

function iconForTool(category: string): string {
  switch (category) {
    case 'shell':
      return 'terminal';
    case 'read':
      return 'eye';
    case 'edit':
    case 'write':
      return 'pencil';
    case 'search':
      return 'search';
    case 'subagent':
      return 'bot';
    default:
      return 'wrench';
  }
}

function meaningfulSummary(
  label: string,
  summary: string | null,
): string | null {
  if (!summary || normalize(summary) === normalize(label)) return null;
  return summary;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[.。]+$/u, '')
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}
