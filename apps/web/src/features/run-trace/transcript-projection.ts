import type { ProductExecutionDetailEvent } from '@atomlink-ye/agent-server/product-contract';

export type TranscriptEntry = ProductExecutionDetailEvent & {
  readonly ordinal: number;
  /** Present for cross-Run trace timelines; session transcripts omit it. */
  readonly run_id?: string;
  readonly source_refs?: { readonly run_id: string };
};

export type ProjectedTranscriptEntry = {
  readonly event: TranscriptEntry;
  /** First and last captured timestamps for this visual activity. */
  readonly startedAt: string;
  readonly endedAt: string;
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
  const openReasoning = new Map<string, MutableRow[]>();
  const toolsByActivity = new Map<string, MutableRow>();
  let runSegment = 0;
  let previousSequence: number | null = null;

  for (const entry of entries) {
    // Session transcripts concatenate multiple runs but do not carry run_id.
    // sequence restarts for each run, so a rollback is the available boundary
    // that keeps repeated provider-local activity ids from being coalesced.
    if (previousSequence !== null && entry.sequence < previousSequence)
      runSegment += 1;
    previousSequence = entry.sequence;
    const runKey = entryRunKey(entry, runSegment);

    if (entry.kind === 'reasoning_progress') {
      const reasoningStack = openReasoning.get(runKey) ?? [];
      const previousOpen = reasoningStack.at(-1);
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
        const started = reasoningStack.pop();
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
      const row = makeRow(entry, runSegment, runKey);
      rows.push(row);
      if (entry.status === 'started') {
        reasoningStack.push(row);
        openReasoning.set(runKey, reasoningStack);
      }
      continue;
    }

    if (entry.kind === 'tool_status') {
      const activityKey = scopedActivityKey(runKey, entry.activity_id);
      const existing = toolsByActivity.get(activityKey);
      if (existing) {
        existing.event = mergeToolEvent(existing.event as ToolEntry, entry);
        existing.endedAt = entry.created_at;
        existing.sourceOrdinals.push(entry.ordinal);
      } else {
        const row = makeRow(entry, runSegment, runKey);
        rows.push(row);
        toolsByActivity.set(activityKey, row);
      }
      continue;
    }

    if (entry.kind === 'assistant_text') {
      const previous = rows.at(-1);
      // The provider may republish the same turn as a cumulative snapshot
      // (each event contains the full text so far) or as independent
      // incremental chunks (each event is only the newly generated slice).
      // rows.at(-1) being assistant_text already proves nothing of another
      // kind (a tool call, a reasoning block, a run boundary) landed between
      // this entry and the previous one, since any of those would have
      // pushed their own row and become the new tail; runSegment is checked
      // explicitly because a sequence rollback can still leave an
      // assistant_text row as the tail of the prior run.
      if (
        previous?.event.kind === 'assistant_text' &&
        previous.runKey === runKey
      ) {
        previous.event = {
          ...entry,
          text: mergeAssistantText(
            previous.event.text,
            previous.lastAssistantText ?? previous.event.text,
            entry.text,
          ),
        };
        previous.lastAssistantText = entry.text;
        previous.sourceOrdinals.push(entry.ordinal);
      } else {
        rows.push(makeRow(entry, runSegment, runKey));
      }
      continue;
    }

    rows.push(makeRow(entry, runSegment, runKey));
  }

  const mergedReasoning = mergeAdjacentReasoning(rows);
  return nestChildren(mergedReasoning);
}

type MutableRow = {
  event: TranscriptEntry;
  startedAt: string;
  endedAt: string;
  detailSourceOrdinals?: number[];
  sourceOrdinals: number[];
  runSegment: number;
  runKey: string;
  lastAssistantText?: string;
  children?: MutableRow[];
};
type ReasoningEntry = Extract<
  TranscriptEntry,
  { readonly kind: 'reasoning_progress' }
>;
type ToolEntry = Extract<TranscriptEntry, { readonly kind: 'tool_status' }>;

function makeRow(
  event: TranscriptEntry,
  runSegment: number,
  runKey: string,
): MutableRow {
  return {
    event,
    startedAt: event.created_at,
    endedAt: event.created_at,
    sourceOrdinals: [event.ordinal],
    runSegment,
    runKey,
    ...(event.kind === 'assistant_text'
      ? { lastAssistantText: event.text }
      : {}),
  };
}

function entryRunKey(entry: TranscriptEntry, runSegment: number): string {
  return entry.source_refs?.run_id ?? entry.run_id ?? String(runSegment);
}

function scopedActivityKey(run: string | number, activityId: string): string {
  return `${run}:${activityId}`;
}

function mergeToolEvent(current: ToolEntry, next: ToolEntry): ToolEntry {
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
      row.event.kind === 'reasoning_progress' &&
      previousVisibleReasoning.runKey === row.runKey
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
    previousVisibleReasoning =
      row.event.kind === 'reasoning_progress'
        ? row
        : row.event.kind === 'usage'
          ? previousVisibleReasoning
          : null;
  }
  return merged;
}

function mergeAssistantText(
  merged: string,
  previousSnapshot: string,
  next: string,
): string {
  if (next.startsWith(previousSnapshot))
    return `${merged.slice(0, -previousSnapshot.length)}${next}`;
  if (previousSnapshot.startsWith(next)) return merged;
  return `${merged}${next}`;
}

function mergeReasoningText(
  previous: string | null,
  next: string | null,
): string | null {
  if (!previous) return next;
  if (!next || next.startsWith(previous)) return next ?? previous;
  if (previous.startsWith(next)) return previous;
  return `${previous}\n${next}`;
}

function nestChildren(
  rows: readonly MutableRow[],
): readonly ProjectedTranscriptEntry[] {
  const parents = new Map(
    rows.flatMap((row) =>
      row.event.kind === 'tool_status'
        ? [[scopedActivityKey(row.runKey, row.event.activity_id), row] as const]
        : [],
    ),
  );
  const visible: MutableRow[] = [];
  for (const row of rows) {
    // Handle child_timeline_item (original logic)
    if (row.event.kind === 'child_timeline_item') {
      const parent = parents.get(
        scopedActivityKey(row.runKey, row.event.parent_activity_id),
      );
      if (!parent) {
        visible.push(row);
        continue;
      }
      parent.detailSourceOrdinals ??= [...parent.sourceOrdinals];
      (parent.children ??= []).push(row);
      parent.sourceOrdinals.push(...row.sourceOrdinals);
      continue;
    }

    // Handle tool_status with parent_activity_id
    if (
      row.event.kind === 'tool_status' &&
      row.event.parent_activity_id !== null
    ) {
      const parent = parents.get(
        scopedActivityKey(row.runKey, row.event.parent_activity_id),
      );
      if (parent && parent !== row) {
        parent.detailSourceOrdinals ??= [...parent.sourceOrdinals];
        (parent.children ??= []).push(row);
        parent.sourceOrdinals.push(...row.sourceOrdinals);
        continue;
      }
    }

    // Default: add to visible
    visible.push(row);
  }
  return visible.map(freezeRow);
}

function freezeRow(row: MutableRow): ProjectedTranscriptEntry {
  return {
    event: row.event,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    detailSourceOrdinals: row.detailSourceOrdinals ?? row.sourceOrdinals,
    sourceOrdinals: row.sourceOrdinals,
    ...(row.children?.length ? { children: row.children.map(freezeRow) } : {}),
  };
}
