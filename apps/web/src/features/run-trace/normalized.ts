import type { ProductRunTrace } from '@atomlink-ye/agent-server/product-contract';

type ProductTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

export type TraceWork = {
  readonly id: string;
  readonly title: string;
};

export type TraceWorkRun = {
  readonly id: string;
  readonly productState: string;
};

export type TraceActor = {
  readonly id: string;
  readonly name: string | null;
};

export type TraceAttempt = {
  readonly id: string;
  readonly attemptNo: number;
  readonly status: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly timingCaptured: boolean;
  readonly feedbackSummary: string | null;
  readonly feedbackCaptureStatus: string;
  readonly resultSummary: string | null;
  readonly resultCaptureStatus: string;
  readonly workItemId: string;
  // Joins an attempt to the run(s) that executed it. Same column the
  // server already joins on: runs.task_id vs execution_task_id.
  readonly taskId: string | null;
};

export type TraceWorkItem = {
  readonly id: string;
  readonly subject: string;
  readonly actorId: string | null;
  readonly dependencyIds: readonly string[];
  readonly attempts: readonly TraceAttempt[];
};

export type TraceMessage = {
  readonly id: string;
  readonly senderName: string | null;
  readonly recipientName: string | null;
  readonly summary: string | null;
};

export type TraceActivity = {
  readonly activityId: string;
  readonly sequence: number;
  readonly status: string;
  readonly category: string;
  readonly toolName: string;
  readonly resultCaptureStatus: string;
  readonly actorId: string | null;
  readonly workItemId: string | null;
};

export type TraceEdge =
  | {
      readonly kind: 'observed_message';
      readonly messageId: string;
      readonly senderActorId: string | null;
      readonly recipientActorId: string;
      readonly workItemId: string | null;
      readonly attemptId: string | null;
      readonly sourceCreatedAt: string;
    }
  | {
      readonly kind: 'declared_dependency';
      readonly dependentWorkItemId: string;
      readonly prerequisiteWorkItemId: string;
    }
  | {
      readonly kind: 'assignment';
      readonly workItemId: string;
      readonly attemptId: string;
      readonly assigneeActorId: string;
    }
  | {
      readonly kind: 'feedback';
      readonly workItemId: string;
      readonly attemptId: string;
      readonly reviewerActorId: string | null;
    };

export type TraceExecutionRun = {
  // The run's own identity. Timeline spans are keyed on this -- a run is
  // what is actually plotted; an attempt is a team-shaped label a run may
  // or may not carry.
  readonly id: string;
  readonly status: string;
  readonly actorId: string | null;
  readonly workItemId: string | null;
  readonly taskId: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
};

export type TraceExecutionEvent = {
  readonly sequence: number;
  readonly type: string;
  readonly createdAt: string;
  readonly runId: string;
};

export type TraceCoverage = {
  readonly scope: string;
  readonly completeness: string;
  readonly excludedExecution: readonly string[];
};

export type NormalizedTrace = {
  readonly runId: string;
  readonly work: TraceWork;
  readonly workRun: TraceWorkRun;
  readonly actors: ReadonlyMap<string, TraceActor>;
  readonly workItems: ReadonlyMap<string, TraceWorkItem>;
  readonly attempts: ReadonlyMap<string, TraceAttempt>;
  readonly messages: ReadonlyMap<string, TraceMessage>;
  readonly activities: readonly TraceActivity[];
  readonly edges: readonly TraceEdge[];
  readonly runs: readonly TraceExecutionRun[];
  readonly events: readonly TraceExecutionEvent[];
  readonly timeline: {
    readonly startedAt: number | null;
    readonly endedAt: number | null;
  };
  readonly coverage: TraceCoverage;
};

/** The only production boundary that traverses ProductRunTrace. */
export function normalizeProductRunTrace(
  productTrace: ProductTrace,
): NormalizedTrace {
  const workItems = new Map<string, TraceWorkItem>();
  const attempts = new Map<string, TraceAttempt>();
  for (const item of productTrace.work_items) {
    const normalizedAttempts = item.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNo: attempt.attempt_no,
      status: attempt.status,
      startedAt: attempt.started_at,
      endedAt: attempt.ended_at,
      durationMs: attempt.duration_ms,
      timingCaptured: attempt.timing_capture_status === 'captured',
      feedbackSummary: attempt.feedback_summary,
      feedbackCaptureStatus: attempt.feedback_capture_status,
      resultSummary: attempt.result_summary,
      resultCaptureStatus: attempt.result_capture_status,
      workItemId: item.id,
      taskId: attempt.source_refs.task_id ?? null,
    }));
    const normalizedItem = {
      id: item.id,
      subject: item.subject,
      actorId: item.actor_id,
      dependencyIds: item.dependency_ids,
      attempts: normalizedAttempts,
    };
    workItems.set(item.id, normalizedItem);
    for (const attempt of normalizedAttempts) attempts.set(attempt.id, attempt);
  }
  const actors = new Map(
    productTrace.actors.map((actor) => [
      actor.id,
      {
        id: actor.id,
        name: actor.name,
      },
    ]),
  );
  const messages = new Map(
    productTrace.messages.map((message) => [
      message.id,
      {
        id: message.id,
        senderName: message.sender_name,
        recipientName: message.recipient_name,
        summary: message.summary,
      },
    ]),
  );
  const activities = productTrace.mcp_activities.map((activity) => ({
    activityId: activity.activity_id,
    sequence: activity.sequence,
    status: activity.status,
    category: activity.category,
    toolName: activity.tool_name,
    resultCaptureStatus: activity.result_capture_status,
    actorId: activity.source_refs.actor_id ?? null,
    workItemId: activity.source_refs.work_item_id ?? null,
  }));
  const edges: TraceEdge[] = productTrace.edges.map((edge) => {
    if (edge.kind === 'observed_message')
      return {
        kind: edge.kind,
        messageId: edge.message_id,
        senderActorId: edge.sender_actor_id,
        recipientActorId: edge.recipient_actor_id,
        workItemId: edge.work_item_id,
        attemptId: edge.attempt_id,
        sourceCreatedAt: edge.source_created_at,
      };
    if (edge.kind === 'declared_dependency')
      return {
        kind: edge.kind,
        dependentWorkItemId: edge.dependent_work_item_id,
        prerequisiteWorkItemId: edge.prerequisite_work_item_id,
      };
    if (edge.kind === 'assignment')
      return {
        kind: edge.kind,
        workItemId: edge.work_item_id,
        attemptId: edge.attempt_id,
        assigneeActorId: edge.assignee_actor_id,
      };
    return {
      kind: edge.kind,
      workItemId: edge.work_item_id,
      attemptId: edge.attempt_id,
      reviewerActorId: edge.reviewer_actor_id,
    };
  });
  // The subhead range is min(run.started_at) / max(run.ended_at), with a
  // live fallback to the latest observed event when no run has ended yet.
  // Runs -- not attempts -- are the source: a single-agent Work has no
  // attempts at all, and this field previously read null for it. Never
  // fall back to wall-clock time; that would assert activity beyond what
  // was captured.
  const runStartedAtValues = productTrace.runs
    .map((run) => run.started_at)
    .filter((value): value is string => value !== null);
  const runEndedAtValues = productTrace.runs
    .map((run) => run.ended_at)
    .filter((value): value is string => value !== null);
  const eventCreatedAtValues = productTrace.events.map(
    (event) => event.created_at,
  );
  const startedAt = runStartedAtValues.length
    ? Math.min(...runStartedAtValues.map((value) => Date.parse(value)))
    : null;
  const endedAt = runEndedAtValues.length
    ? Math.max(...runEndedAtValues.map((value) => Date.parse(value)))
    : eventCreatedAtValues.length
      ? Math.max(...eventCreatedAtValues.map((value) => Date.parse(value)))
      : null;
  return {
    runId: productTrace.work_run.id,
    work: { id: productTrace.work.id, title: productTrace.work.title },
    workRun: {
      id: productTrace.work_run.id,
      productState: productTrace.work_run.product_state,
    },
    actors,
    workItems,
    attempts,
    messages,
    activities,
    edges,
    runs: productTrace.runs.map((run) => ({
      // The mapper on the server side always sets source_refs.run_id for
      // execution runs (see mapRun in product-projection.ts); the field is
      // typed optional only because ProductSourceRefsSchema is one fixed
      // shared shape. Same non-null idiom already used for run_id in
      // edges.ts's event/activity ordering comparators.
      id: run.source_refs.run_id!,
      status: run.status,
      actorId: run.actor_id,
      workItemId: run.work_item_id,
      taskId: run.source_refs.task_id ?? null,
      startedAt: run.started_at,
      endedAt: run.ended_at,
    })),
    events: productTrace.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      createdAt: event.created_at,
      runId: event.source_refs.run_id,
    })),
    timeline: { startedAt, endedAt },
    coverage: {
      scope: productTrace.timeline_coverage.scope,
      completeness: productTrace.timeline_coverage.completeness,
      excludedExecution: productTrace.timeline_coverage.excluded_execution,
    },
  };
}
