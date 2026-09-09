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
  options: {
    readonly terminalRun?: boolean;
    readonly actorName?: string | null;
  } = {},
): EntryPresentation {
  if (event.kind === 'lifecycle')
    return {
      icon: lifecycleIcon(event.status),
      // A Team trace is an interleaved record of several provider-local Runs.
      // Their lifecycle sequences all begin at one, so retaining the captured
      // actor is necessary to distinguish simultaneous "Run started" rows.
      label: lifecycleLabel(event.status, options.actorName),
      summary: null,
      origin: null,
      platformToolName: null,
      tone:
        event.status === 'failed' || event.status === 'cancelled'
          ? 'failed'
          : event.status === 'started' || event.status === 'running'
            ? 'running'
            : 'normal',
      detailText: null,
      detailKind: null,
      exitCode: null,
      expandable: false,
    };
  if (event.kind === 'assistant_text')
    return {
      icon: 'bot',
      label: options.actorName?.trim() || 'Assistant response',
      summary: textSummary(event.text),
      origin: null,
      platformToolName: null,
      tone: 'normal',
      detailText: event.text,
      detailKind: null,
      exitCode: null,
      expandable: Boolean(event.text),
    };
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
            : event.status === 'running' && !options.terminalRun
              ? 'running'
              : 'normal',
        detailText: null,
        detailKind: null,
        exitCode: null,
        expandable: true,
      };
    const hasToolIdentity =
      event.label !== null ||
      event.tool_name !== null ||
      event.detail_text !== null;
    const label = toolActivityLabel(event);
    const detailText = toolDetail(event);
    return {
      icon: iconForTool(event.category),
      label,
      summary: meaningfulSummary(label, event.summary),
      origin: null,
      platformToolName: null,
      tone:
        event.status === 'failed' || event.status === 'cancelled'
          ? 'failed'
          : event.status === 'running' && !options.terminalRun
            ? 'running'
            : 'normal',
      detailText: hasToolIdentity ? detailText : null,
      detailKind: hasToolIdentity ? event.detail_kind : null,
      exitCode: hasToolIdentity ? event.exit_code : null,
      expandable:
        hasToolIdentity && (Boolean(detailText) || event.exit_code !== null),
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

function textSummary(text: string): string | null {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  if (!normalized) return null;
  return normalized.length > 180
    ? `${normalized.slice(0, 177)}...`
    : normalized;
}

function lifecycleLabel(status: string, actorName?: string | null): string {
  const prefix = actorName?.trim() ? `${actorName.trim()} · ` : '';
  switch (status) {
    case 'started':
      return `${prefix}Run started`;
    case 'succeeded':
      return `${prefix}Run succeeded`;
    case 'failed':
      return `${prefix}Run failed`;
    case 'cancelled':
      return `${prefix}Run cancelled`;
    default:
      return `${prefix}Run ${humanize(status)}`;
  }
}

function lifecycleIcon(status: string): string {
  return status === 'failed' || status === 'cancelled'
    ? 'error'
    : status === 'started' || status === 'running'
      ? 'play'
      : 'check';
}

function toolActivityLabel(
  event: Extract<TranscriptEntry, { readonly kind: 'tool_status' }>,
): string {
  const label = event.label?.trim() ?? null;
  const summary = event.summary?.trim() ?? null;
  const command = commandFromLabel(label);
  // Fallback order: a non-generic summary, command embedded in the provider
  // label, non-generic label, then captured category. Generic provider
  // fallbacks are never used as a primary title.
  if (summary && !isGenericActivityText(summary)) return summary;
  if (command) return command;
  if (label && !isGenericActivityText(label)) return label;
  return humanize(event.category);
}

function toolDetail(
  event: Extract<TranscriptEntry, { readonly kind: 'tool_status' }>,
): string | null {
  if (event.category !== 'shell') return event.detail_text;
  const command = commandFromLabel(event.label);
  if (!command) return event.detail_text;
  return event.detail_text
    ? `Recorded command\n${command}\n\nOutput\n${event.detail_text}`
    : `Recorded command\n${command}`;
}

function commandFromLabel(label: string | null): string | null {
  const match = label?.trim().match(/^(?:shell|other) activity:\s*(.+)$/iu);
  return match?.[1]?.trim() || null;
}

function isGenericActivityText(value: string): boolean {
  return /^(?:other|read|search|shell|write|edit) activity\.?$/iu.test(
    value.trim(),
  );
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
  if (
    !summary ||
    isGenericActivityText(summary) ||
    normalize(summary) === normalize(label)
  )
    return null;
  return summary;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[.。]+$/u, '')
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}
