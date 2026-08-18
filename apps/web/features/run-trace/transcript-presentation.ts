import type { TranscriptEntry } from './transcript-projection';

export type EntryPresentation = {
  readonly icon: string;
  readonly label: string;
  readonly summary: string | null;
  readonly tone: 'normal' | 'failed' | 'running';
  readonly detailText: string | null;
  readonly detailKind: string | null;
  readonly exitCode: number | null;
  readonly expandable: boolean;
};

export function buildEntryPresentation(event: TranscriptEntry): EntryPresentation {
  if (event.kind === 'reasoning_progress')
    return {
      icon: 'brain', label: 'Thinking', summary: null,
      tone: event.status === 'started' ? 'running' : 'normal',
      detailText: event.text, detailKind: null, exitCode: null, expandable: Boolean(event.text),
    };
  if (event.kind === 'tool_status') {
    const label = event.label ?? humanize(event.tool_name ?? event.category);
    return {
      icon: iconForTool(event.category), label, summary: event.summary,
      tone: event.status === 'failed' || event.status === 'cancelled' ? 'failed' : event.status === 'running' ? 'running' : 'normal',
      detailText: event.detail_text, detailKind: event.detail_kind, exitCode: event.exit_code,
      expandable: Boolean(event.detail_text) || event.exit_code !== null,
    };
  }
  if (event.kind === 'child_timeline_item')
    return {
      icon: iconForTool(event.item_kind === 'reasoning' ? 'other' : event.item_kind === 'tool' ? 'other' : 'subagent'),
      label: event.label, summary: event.summary,
      tone: event.status === 'failed' || event.status === 'cancelled' ? 'failed' : event.status === 'running' ? 'running' : 'normal',
      detailText: event.detail_text, detailKind: event.detail_kind, exitCode: event.exit_code,
      expandable: Boolean(event.detail_text) || event.exit_code !== null,
    };
  if (event.kind === 'permission') {
    const decision = event.decision ? humanize(event.decision) : event.status === 'resolved' ? 'Resolved' : 'Not captured / not triggered';
    return { icon: 'lock', label: 'Permission check', summary: `${decision}${event.summary ? ` · ${event.summary}` : ''}`, tone: 'normal', detailText: null, detailKind: null, exitCode: null, expandable: false };
  }
  return { icon: 'wrench', label: humanize(event.kind), summary: null, tone: 'normal', detailText: null, detailKind: null, exitCode: null, expandable: false };
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function iconForTool(category: string): string {
  switch (category) {
    case 'shell': return 'terminal';
    case 'read': return 'eye';
    case 'edit': case 'write': return 'pencil';
    case 'search': return 'search';
    case 'subagent': return 'bot';
    default: return 'wrench';
  }
}
