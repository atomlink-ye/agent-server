import {
  capturedTimelineRange,
  timelineGeometry,
  type CapturedRange,
  type Geometry,
  type TraceEntry,
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

export type ActorRow = {
  readonly key: string;
  readonly name: string;
  readonly items: readonly TraceWorkItem[];
};

export type TimelineModel = {
  readonly attempts: readonly TraceEntry[];
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

export function selectTimelineModel(trace: NormalizedTrace): TimelineModel {
  const attempts = selectAttemptEntries(trace);
  return {
    attempts,
    actorRows: selectActorRows(trace),
    geometry: timelineGeometry(attempts),
    range: capturedTimelineRange(attempts),
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

export function selectActorRows(trace: NormalizedTrace): readonly ActorRow[] {
  const rows = [...trace.actors.values()].map((actor) => ({
    key: actor.id,
    name: actor.name ?? 'Name not captured',
    items: [...trace.workItems.values()].filter(
      (workItem) => workItem.actorId === actor.id,
    ),
  }));
  const unassignedItems = [...trace.workItems.values()].filter(
    (workItem) => !workItem.actorId || !trace.actors.has(workItem.actorId),
  );
  return unassignedItems.length
    ? [
        ...rows,
        {
          key: 'uncaptured-actor',
          name: 'Name not captured',
          items: unassignedItems,
        },
      ]
    : rows;
}

export function interactionsForWorkItem(
  trace: NormalizedTrace,
  workItemId: string,
) {
  return {
    messages: trace.edges.filter(
      (edge) =>
        edge.kind === 'observed_message' && edge.workItemId === workItemId,
    ).length,
    activities: trace.activities.filter(
      (activity) => activity.workItemId === workItemId,
    ).length,
  };
}

export function longestAttemptMs(trace: NormalizedTrace): number | null {
  return [...trace.attempts.values()].reduce<number | null>(
    (max, attempt) =>
      attempt.durationMs !== null && (max === null || attempt.durationMs > max)
        ? attempt.durationMs
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
