import type { ProductExecutionDetailEvent } from '@atomlink-ye/agent-server/product-contract';

export type TranscriptEntry = ProductExecutionDetailEvent & {
  readonly ordinal: number;
};

export type ProjectedTranscriptEntry = {
  readonly event: TranscriptEntry;
  /** Ordinals that produced this row's own visible event, excluding nested children. */
  readonly detailSourceOrdinals: readonly number[];
  readonly sourceOrdinals: readonly number[];
  readonly children?: readonly ProjectedTranscriptEntry[];
};

const terminalToolStatuses = new Map([
  ['running', 0],
  ['completed', 1],
  ['cancelled', 2],
  ['failed', 3],
]);

/**
 * Turns the append-only provider transcript into the small set of visual
 * units used by the session reader. This deliberately does not use the live
 * stream reducer: a session can contain several completed runs.
 */
export function projectTranscript(
  entries: readonly TranscriptEntry[],
): readonly ProjectedTranscriptEntry[] {
  const rows: MutableRow[] = [];
  const openReasoning: MutableRow[] = [];
  const toolsByActivity = new Map<string, MutableRow>();
  let runSegment = 0;
  let previousSequence: number | null = null;

  for (const entry of entries) {
    // Session transcripts concatenate multiple runs but do not carry run_id.
    // sequence restarts for each run, so a rollback is the available boundary
    // that keeps repeated provider-local activity ids from being coalesced.
    if (previousSequence !== null && entry.sequence < previousSequence) runSegment += 1;
    previousSequence = entry.sequence;

    if (entry.kind === 'reasoning_progress') {
      const previousOpen = openReasoning.at(-1);
      if (
        entry.status === 'started' &&
        previousOpen &&
        previousOpen.sourceOrdinals.at(-1) === entry.ordinal - 1
      ) {
        const previousEvent = previousOpen.event as ReasoningEntry;
        previousOpen.event = {
          ...previousEvent,
          text: mergeReasoningText(previousEvent.text, entry.text),
        };
        previousOpen.sourceOrdinals.push(entry.ordinal);
        continue;
      }
      if (entry.status === 'completed') {
        const started = openReasoning.pop();
        if (started) {
          const startedEvent = started.event as ReasoningEntry;
          started.event = {
            ...startedEvent,
            status: 'completed',
            text: mergeReasoningText(startedEvent.text, entry.text),
          };
          started.sourceOrdinals.push(entry.ordinal);
          continue;
        }
      }
      const row = makeRow(entry, runSegment);
      rows.push(row);
      if (entry.status === 'started') openReasoning.push(row);
      continue;
    }

    if (entry.kind === 'tool_status') {
      const activityKey = scopedActivityKey(runSegment, entry.activity_id);
      const existing = toolsByActivity.get(activityKey);
      if (existing) {
        existing.event = mergeToolEvent(existing.event as ToolEntry, entry);
        existing.sourceOrdinals.push(entry.ordinal);
      } else {
        const row = makeRow(entry, runSegment);
        rows.push(row);
        toolsByActivity.set(activityKey, row);
      }
      continue;
    }

    if (entry.kind === 'assistant_text') {
      const previous = rows.at(-1);
      // Keep the latest only when the observed text proves this is a cumulative
      // snapshot; real provider text may also arrive as independent chunks.
      if (
        previous?.event.kind === 'assistant_text' &&
        entry.text.startsWith(previous.event.text)
      ) {
        previous.event = entry;
        previous.sourceOrdinals.push(entry.ordinal);
      } else {
        rows.push(makeRow(entry, runSegment));
      }
      continue;
    }

    rows.push(makeRow(entry, runSegment));
  }

  const mergedReasoning = mergeAdjacentReasoning(rows);
  return nestChildren(mergedReasoning);
}

type MutableRow = {
  event: TranscriptEntry;
  detailSourceOrdinals?: number[];
  sourceOrdinals: number[];
  runSegment: number;
  children?: MutableRow[];
};
type ReasoningEntry = Extract<TranscriptEntry, { readonly kind: 'reasoning_progress' }>;
type ToolEntry = Extract<TranscriptEntry, { readonly kind: 'tool_status' }>;

function makeRow(event: TranscriptEntry, runSegment: number): MutableRow {
  return { event, sourceOrdinals: [event.ordinal], runSegment };
}

function scopedActivityKey(runSegment: number, activityId: string): string {
  return `${runSegment}:${activityId}`;
}

function mergeToolEvent(
  current: ToolEntry,
  next: ToolEntry,
): ToolEntry {
  const currentPriority = terminalToolStatuses.get(current.status) ?? -1;
  const nextPriority = terminalToolStatuses.get(next.status) ?? -1;
  const winner = nextPriority >= currentPriority ? next : current;
  const fallback = winner === current ? next : current;
  return {
    ...winner,
    label: winner.label ?? fallback.label,
    summary: winner.summary ?? fallback.summary,
    provider: winner.provider ?? fallback.provider,
    tool_name: winner.tool_name ?? fallback.tool_name,
    detail_kind: winner.detail_kind ?? fallback.detail_kind,
    detail_text: winner.detail_text ?? fallback.detail_text,
    exit_code: winner.exit_code ?? fallback.exit_code,
  };
}

function mergeAdjacentReasoning(rows: readonly MutableRow[]): MutableRow[] {
  const merged: MutableRow[] = [];
  let previousVisibleReasoning: MutableRow | null = null;
  for (const row of rows) {
    if (
      previousVisibleReasoning &&
      row.event.kind === 'reasoning_progress'
    ) {
      const previousEvent = previousVisibleReasoning.event as ReasoningEntry;
      const rowEvent = row.event as ReasoningEntry;
      previousVisibleReasoning.event = {
        ...previousEvent,
        status: rowEvent.status,
        text: mergeReasoningText(previousEvent.text, rowEvent.text),
      };
      previousVisibleReasoning.sourceOrdinals.push(...row.sourceOrdinals);
      continue;
    }

    merged.push(row);
    // Usage is rendered into a footer rather than the primary stream, so it
    // does not visually separate two reasoning blocks. Every other row does.
    previousVisibleReasoning = row.event.kind === 'reasoning_progress'
      ? row
      : row.event.kind === 'usage'
        ? previousVisibleReasoning
        : null;
  }
  return merged;
}

function mergeReasoningText(previous: string | null, next: string | null): string | null {
  if (!previous) return next;
  if (!next || next.startsWith(previous)) return next ?? previous;
  if (previous.startsWith(next)) return previous;
  return `${previous}\n${next}`;
}

function nestChildren(rows: readonly MutableRow[]): readonly ProjectedTranscriptEntry[] {
  const parents = new Map(
    rows.flatMap((row) =>
      row.event.kind === 'tool_status' ? [[scopedActivityKey(row.runSegment, row.event.activity_id), row] as const] : [],
    ),
  );
  const visible: MutableRow[] = [];
  for (const row of rows) {
    if (row.event.kind !== 'child_timeline_item') {
      visible.push(row);
      continue;
    }
    const parent = parents.get(scopedActivityKey(row.runSegment, row.event.parent_activity_id));
    if (!parent) {
      visible.push(row);
      continue;
    }
    parent.detailSourceOrdinals ??= [...parent.sourceOrdinals];
    (parent.children ??= []).push(row);
    parent.sourceOrdinals.push(...row.sourceOrdinals);
  }
  return visible.map(freezeRow);
}

function freezeRow(row: MutableRow): ProjectedTranscriptEntry {
  return {
    event: row.event,
    detailSourceOrdinals: row.detailSourceOrdinals ?? row.sourceOrdinals,
    sourceOrdinals: row.sourceOrdinals,
    ...(row.children?.length ? { children: row.children.map(freezeRow) } : {}),
  };
}
