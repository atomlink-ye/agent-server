import {
  capturedTimelineRange,
  timelineGeometry,
  type CapturedRange,
  type Geometry,
  type TimelineSpan,
} from './geometry';
import type {
  NormalizedTrace,
  TraceActor,
  TraceActivity,
  TraceAttempt,
  TraceEdge,
  TraceMessage,
  TraceWorkItem,
} from './normalized';

export type TraceEntry = {
  readonly workItem: TraceWorkItem;
  readonly attempt: TraceAttempt;
};

/** One grouped row of spans inside a lane -- a team Work Item's attempts,
 * or (when there is no captured Work Item) the runs sharing a lane key. */
export type TimelineLaneRow = {
  readonly key: string;
  readonly subject: string | null;
  readonly workItemId: string | null;
  readonly actorId: string | null;
  readonly spans: readonly TimelineSpan[];
};

export type ActorRow = {
  readonly key: string;
  readonly name: string;
  /** What this lane is, when it is not an agent. */
  readonly note: string | null;
  readonly rows: readonly TimelineLaneRow[];
};

export type TimelineModel = {
  readonly spans: readonly TimelineSpan[];
  readonly actorRows: readonly ActorRow[];
  readonly geometry: ReadonlyMap<string, Geometry>;
  readonly range: CapturedRange | null;
  readonly feedbackAttemptIds: ReadonlySet<string>;
  readonly messageEdges: readonly Extract<
    TraceEdge,
    { kind: 'observed_message' }
  >[];
};

export type MapRelation = {
  readonly key: string;
  readonly kind: string;
  readonly text: string;
  readonly messageId?: string;
};

export type MapModel = {
  readonly entries: readonly TraceEntry[];
  readonly levels: ReadonlyMap<string, number>;
  readonly relations: readonly MapRelation[];
};

export type EventModel = {
  readonly activities: readonly {
    readonly activity: TraceActivity;
    readonly actor: TraceActor | null;
    readonly workItem: TraceWorkItem | null;
    readonly key: string;
    readonly attemptAssociation: string | null;
  }[];
};

export type InspectorMode = 'overview' | 'conversation' | 'activity';

export type InspectorModel = {
  readonly selectedAttempt: TraceEntry | null;
  readonly selectedMessageId: string | null;
  readonly actorName: string;
  readonly messages: readonly {
    readonly edge: Extract<TraceEdge, { kind: 'observed_message' }>;
    readonly message: TraceMessage | undefined;
  }[];
  readonly activities: readonly TraceActivity[];
};

export function selectAttemptEntries(
  trace: NormalizedTrace,
): readonly TraceEntry[] {
  return [...trace.attempts.values()].map((attempt) => ({
    workItem: trace.workItems.get(attempt.workItemId)!,
    attempt,
  }));
}

export function attemptsFrom(trace: NormalizedTrace): readonly TraceEntry[] {
  return selectAttemptEntries(trace);
}

/**
 * Builds one TimelineSpan per run, joining attemptId via taskId -- the
 * same column the server already joins runs.task_id against
 * team_work_item_attempts.execution_task_id on. This is why a
 * single-agent Work (no attempts) still gets spans: they come from runs,
 * not from the attempt join.
 */
export function selectTimelineSpans(
  trace: NormalizedTrace,
): readonly TimelineSpan[] {
  const attemptsByTaskId = new Map<string, TraceAttempt>();
  for (const attempt of trace.attempts.values())
    if (attempt.taskId) attemptsByTaskId.set(attempt.taskId, attempt);
  const lastEventAtByRunId = new Map<string, string>();
  for (const event of trace.events) {
    const current = lastEventAtByRunId.get(event.runId);
    if (!current || event.createdAt.localeCompare(current) > 0)
      lastEventAtByRunId.set(event.runId, event.createdAt);
  }
  return trace.runs.map((run) => {
    // A still-running run has no ended_at yet. Fall back to the last
    // event this specific run is known to have emitted -- never
    // Date.now(), which would draw activity beyond what was captured.
    const endedAt = run.endedAt ?? lastEventAtByRunId.get(run.id) ?? null;
    const durationMs =
      run.startedAt !== null && endedAt !== null
        ? Math.max(0, Date.parse(endedAt) - Date.parse(run.startedAt))
        : null;
    const attempt = run.taskId ? attemptsByTaskId.get(run.taskId) : undefined;
    return {
      key: run.id,
      laneKey: run.actorId ?? run.taskId ?? run.id,
      startedAt: run.startedAt,
      endedAt,
      durationMs,
      timingCaptured: run.startedAt !== null && endedAt !== null,
      status: run.status,
      attemptId: attempt?.id ?? null,
      workItemId: run.workItemId,
    };
  });
}

export function selectTimelineModel(trace: NormalizedTrace): TimelineModel {
  const spans = selectTimelineSpans(trace);
  return {
    spans,
    actorRows: selectActorRows(trace),
    geometry: timelineGeometry(spans),
    range: capturedTimelineRange(spans),
    feedbackAttemptIds: new Set(
      trace.edges.flatMap((edge) =>
        edge.kind === 'feedback' ? [edge.attemptId] : [],
      ),
    ),
    messageEdges: trace.edges.filter(
      (edge): edge is Extract<TraceEdge, { kind: 'observed_message' }> =>
        edge.kind === 'observed_message',
    ),
  };
}

export function selectMapModel(trace: NormalizedTrace): MapModel {
  return {
    entries: selectAttemptEntries(trace),
    levels: selectWorkItemLevels(trace),
    relations: selectMapRelations(trace),
  };
}

export function selectEventModel(trace: NormalizedTrace): EventModel {
  return {
    activities: trace.activities.map((activity, snapshotOrdinal) => {
      const actor = activity.actorId
        ? (trace.actors.get(activity.actorId) ?? null)
        : null;
      const workItem = activity.workItemId
        ? (trace.workItems.get(activity.workItemId) ?? null)
        : null;
      return {
        activity,
        actor,
        workItem,
        key: `${activity.activityId}:${snapshotOrdinal}`,
        attemptAssociation:
          workItem?.attempts.length === 1 ? workItem.attempts[0]!.id : null,
      };
    }),
  };
}

export function selectInspectorModel(
  trace: NormalizedTrace,
  selectedAttemptId: string | null,
  selectedMessageId: string | null,
): InspectorModel {
  const selectedAttempt =
    selectAttemptEntries(trace).find(
      (entry) => entry.attempt.id === selectedAttemptId,
    ) ?? null;
  const messages = trace.edges.flatMap((edge) => {
    if (
      edge.kind !== 'observed_message' ||
      (selectedAttempt &&
        edge.attemptId !== selectedAttempt.attempt.id &&
        edge.workItemId !== selectedAttempt.workItem.id &&
        edge.messageId !== selectedMessageId) ||
      (!selectedAttempt && edge.messageId !== selectedMessageId)
    )
      return [];
    return [{ edge, message: trace.messages.get(edge.messageId) }];
  });
  const activities = selectedAttempt
    ? trace.activities.filter(
        (activity) => activity.workItemId === selectedAttempt.workItem.id,
      )
    : [];
  return {
    selectedAttempt,
    selectedMessageId,
    actorName: selectedAttempt
      ? (trace.actors.get(selectedAttempt.workItem.actorId ?? '')?.name ??
        'Name not captured')
      : 'Name not captured',
    messages,
    activities,
  };
}

/**
 * Lanes for the Timeline. Team traces keep one lane per captured actor, plus
 * the Work Run's own root run: the run whose task is the root task, which has
 * no actor because it belongs to the Work rather than to any agent. That lane
 * used to be labeled "Name not captured", which read as a capture defect for
 * the one run that is working exactly as designed. The honest catch-all is
 * still there for a span that resolves to neither.
 *
 * A single-agent Work has no captured actors at all -- trace.actors is empty --
 * so it falls back to one lane per distinct task, named neutrally. It is not
 * labeled "lead": role === 'lead' gates real lead behavior in the domain, and a
 * lone agent does not hold that role.
 */
export function selectActorRows(trace: NormalizedTrace): readonly ActorRow[] {
  const spans = selectTimelineSpans(trace);
  if (trace.actors.size === 0) return selectSingleAgentLanes(spans);
  const rootRunIds = new Set(
    trace.runs
      .filter(
        (run) =>
          run.actorId === null &&
          run.taskId !== null &&
          run.taskId === run.rootTaskId,
      )
      .map((run) => run.id),
  );
  const spansByActorId = new Map<string, TimelineSpan[]>();
  const rootSpans: TimelineSpan[] = [];
  const uncapturedSpans: TimelineSpan[] = [];
  for (const span of spans) {
    if (trace.actors.has(span.laneKey)) {
      const bucket = spansByActorId.get(span.laneKey) ?? [];
      bucket.push(span);
      spansByActorId.set(span.laneKey, bucket);
    } else if (rootRunIds.has(span.key)) {
      rootSpans.push(span);
    } else {
      uncapturedSpans.push(span);
    }
  }
  const rows: ActorRow[] = [...trace.actors.values()].map((actor) => ({
    key: actor.id,
    name: actor.name ?? 'Name not captured',
    note: null,
    rows: groupSpansIntoLaneRows(trace, spansByActorId.get(actor.id) ?? [], {
      actorId: actor.id,
    }),
  }));
  if (rootSpans.length)
    rows.push({
      key: 'work-root-run',
      name: 'Work Run',
      note: 'The Work Run itself, not an agent',
      rows: groupSpansIntoLaneRows(trace, rootSpans, { actorId: null }),
    });
  if (uncapturedSpans.length)
    rows.push({
      key: 'uncaptured-actor',
      name: 'Name not captured',
      note: null,
      rows: groupSpansIntoLaneRows(trace, uncapturedSpans, { actorId: null }),
    });
  return rows;
}

function selectSingleAgentLanes(
  spans: readonly TimelineSpan[],
): readonly ActorRow[] {
  const spansByLaneKey = new Map<string, TimelineSpan[]>();
  for (const span of spans) {
    const bucket = spansByLaneKey.get(span.laneKey) ?? [];
    bucket.push(span);
    spansByLaneKey.set(span.laneKey, bucket);
  }
  return [...spansByLaneKey.entries()].map(([key, laneSpans]) => ({
    key,
    name: 'Agent',
    note: null,
    rows: groupSpansIntoLaneRows(null, laneSpans, { actorId: null }),
  }));
}

function groupSpansIntoLaneRows(
  trace: NormalizedTrace | null,
  spans: readonly TimelineSpan[],
  lane: { readonly actorId: string | null },
): readonly TimelineLaneRow[] {
  const grouped = new Map<string, TimelineSpan[]>();
  for (const span of spans) {
    const key = span.workItemId ?? span.laneKey;
    const bucket = grouped.get(key) ?? [];
    bucket.push(span);
    grouped.set(key, bucket);
  }
  return [...grouped.entries()].map(([key, groupedSpans]) => {
    const workItemId = groupedSpans[0]!.workItemId;
    return {
      key,
      subject: workItemId
        ? (trace?.workItems.get(workItemId)?.subject ?? null)
        : null,
      workItemId,
      actorId: lane.actorId,
      spans: groupedSpans,
    };
  });
}

export type RowInteractions = {
  readonly messages: number;
  readonly calls: number;
  readonly tools: readonly { readonly name: string; readonly count: number }[];
};

/**
 * What a lane row actually did, as tool calls rather than dispatch records.
 *
 * Two corrections live here. First, an MCP activity is recorded twice — once
 * when it is dispatched and once when it is confirmed — so counting rows
 * reported double the calls that happened. The pair shares an activity id, but
 * that id is only an ordinal within a session ("activity-2") and repeats across
 * sessions, so the identity has to be the (actor, activity) pair. Second, the
 * count used to be looked up by Work Item alone, which meant a lead's own
 * coordination run — no Work Item, and in a real trace the majority of the tool
 * calls — showed nothing at all, and the Timeline looked like a row of bars with
 * no interaction between them.
 */
export function interactionsForRow(
  trace: NormalizedTrace,
  row: Pick<TimelineLaneRow, 'workItemId' | 'actorId'>,
): RowInteractions {
  const matches = (activity: TraceActivity): boolean =>
    row.workItemId !== null
      ? activity.workItemId === row.workItemId
      : row.actorId !== null &&
        activity.actorId === row.actorId &&
        activity.workItemId === null;
  const seen = new Set<string>();
  const toolCounts = new Map<string, number>();
  for (const activity of trace.activities) {
    if (!matches(activity)) continue;
    const identity = `${activity.actorId ?? ''}:${activity.activityId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    toolCounts.set(
      activity.toolName,
      (toolCounts.get(activity.toolName) ?? 0) + 1,
    );
  }
  return {
    messages: trace.edges.filter((edge) => {
      if (edge.kind !== 'observed_message') return false;
      if (row.workItemId !== null) return edge.workItemId === row.workItemId;
      return (
        row.actorId !== null &&
        edge.workItemId === null &&
        (edge.senderActorId === row.actorId ||
          edge.recipientActorId === row.actorId)
      );
    }).length,
    calls: seen.size,
    tools: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (left, right) =>
          right.count - left.count || left.name.localeCompare(right.name),
      ),
  };
}

/** Longest captured run. Runs (not attempts) are the source, so a rework
 * task with more than one run is no longer silently reported as
 * uncaptured just because the attempt-level timing join required exactly
 * one run per task. */
export function longestAttemptMs(trace: NormalizedTrace): number | null {
  return selectTimelineSpans(trace).reduce<number | null>(
    (max, span) =>
      span.durationMs !== null && (max === null || span.durationMs > max)
        ? span.durationMs
        : max,
    null,
  );
}

export function actorTone(identity: string): string {
  let hash = 0;
  for (const character of identity)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `run-trace__actor--tone-${Math.abs(hash) % 3}`;
}

function selectWorkItemLevels(
  trace: NormalizedTrace,
): ReadonlyMap<string, number> {
  const cache = new Map<string, number>();
  const visiting = new Set<string>();
  const level = (id: string): number => {
    const known = cache.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const item = trace.workItems.get(id);
    const next = item?.dependencyIds.length
      ? 1 +
        Math.max(
          ...item.dependencyIds
            .filter((dependencyId) => trace.workItems.has(dependencyId))
            .map(level),
          0,
        )
      : 0;
    visiting.delete(id);
    cache.set(id, next);
    return next;
  };
  for (const item of trace.workItems.values()) level(item.id);
  return cache;
}

function selectMapRelations(trace: NormalizedTrace): readonly MapRelation[] {
  return trace.edges.flatMap((edge, index) => {
    if (edge.kind === 'declared_dependency')
      return [
        {
          key: `dep:${index}`,
          kind: 'Dependency',
          text: `${trace.workItems.get(edge.prerequisiteWorkItemId)?.subject ?? 'Work Item'} → ${trace.workItems.get(edge.dependentWorkItemId)?.subject ?? 'Work Item'}`,
        },
      ];
    if (edge.kind === 'assignment')
      return [
        {
          key: `assign:${index}`,
          kind: 'Assignment',
          text: `${trace.actors.get(edge.assigneeActorId)?.name ?? 'Agent'} → ${trace.workItems.get(edge.workItemId)?.subject ?? 'Work Item'}`,
        },
      ];
    if (edge.kind === 'feedback') {
      const attempt = trace.attempts.get(edge.attemptId);
      return [
        {
          key: `feedback:${index}`,
          kind: 'Feedback',
          text: `${edge.reviewerActorId ? (trace.actors.get(edge.reviewerActorId)?.name ?? 'Reviewer') : 'Reviewer'} → ${attempt ? `${trace.workItems.get(attempt.workItemId)?.subject ?? 'Work Item'} / Attempt ${attempt.attemptNo}` : (trace.workItems.get(edge.workItemId)?.subject ?? 'Work Item')}`,
        },
      ];
    }
    return [
      {
        key: `message:${edge.messageId}`,
        kind: 'Message',
        text: `${edge.senderActorId ? (trace.actors.get(edge.senderActorId)?.name ?? 'Agent') : 'System'} → ${trace.actors.get(edge.recipientActorId)?.name ?? 'Agent'}`,
        messageId: edge.messageId,
      },
    ];
  });
}

export function captureLabel(value: string): string {
  return value === 'not_present' || value === 'not_captured'
    ? 'Not captured'
    : value === 'redacted'
      ? 'Captured, content redacted'
      : value === 'captured'
        ? 'Captured'
        : humanize(value);
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

export function recordedTimestamp(timestamp: string | null): string {
  return timestamp ?? 'Not captured';
}

export function formatTimestamp(value: string): string {
  return `${value.replace('T', ' ').slice(0, 19)} UTC`;
}
