import type { ExecutionFactQuery } from '../ports/execution-fact-query.js';
import type {
  RunEvent,
  RunEventPayload,
  RunEventRepository,
} from '../ports/run-events.js';
import type { WorkIdentityOwnerScope } from '../ports/work-identity-repository.js';
import type { WorkProjectionFactsSource } from './work-projection-facts-source.js';
import {
  ProductProjectionNotFoundError,
  ProductProjectionUnavailableError,
  type ProductWorkIdentityQuery,
} from './product-projection.js';
import {
  ProductExecutionDetailResponseSchema,
  toolCategories as productToolCategories,
  toolStatuses as productToolStatuses,
  detailKinds as productDetailKinds,
  permissionCategories as productPermissionCategories,
  type ProductExecutionDetailEvent,
  type ProductExecutionDetailResponse,
} from '../../contracts/product-projection/execution-detail.js';

const MAX_DETAIL_EVENTS = 2_000;
const PAGE_SIZE = 100;

export class GetProductExecutionDetail {
  public constructor(
    private readonly workIdentity: Pick<
      ProductWorkIdentityQuery,
      'findWorkById' | 'findWorkRunById'
    >,
    private readonly workFacts: Pick<WorkProjectionFactsSource, 'getByRootTask'>,
    private readonly executionFacts: Pick<ExecutionFactQuery, 'listRunsByRootTask'>,
    private readonly runEvents: Pick<RunEventRepository, 'list'>,
  ) {}

  public async execute(
    input: WorkIdentityOwnerScope & {
      readonly workId: string;
      readonly workRunId: string;
      readonly attemptId: string;
    },
  ): Promise<ProductExecutionDetailResponse> {
    const owner = { tenantId: input.tenantId, workspaceId: input.workspaceId };
    const [work, workRun] = await Promise.all([
      this.workIdentity.findWorkById(input.workId, owner),
      this.workIdentity.findWorkRunById(input.workRunId, owner),
    ]);
    if (
      !work ||
      !workRun ||
      workRun.workId !== work.id ||
      workRun.rootTaskId === null ||
      workRun.boundAt === null
    )
      throw new ProductProjectionNotFoundError();

    const [facts, runs] = await Promise.all([
      this.workFacts.getByRootTask(owner, workRun.rootTaskId),
      this.executionFacts.listRunsByRootTask({ ...owner, rootTaskId: workRun.rootTaskId }),
    ]);
    if (!facts) throw new ProductProjectionUnavailableError();

    const located = facts.identity.work_items
      .flatMap((workItem) =>
        workItem.attempts.map((attempt) => ({ workItem, attempt })),
      )
      .find(({ attempt }) => attempt.id === input.attemptId);
    if (!located) throw new ProductProjectionNotFoundError();

    const executionTaskId = located.attempt.source_refs.task_id;
    if (!executionTaskId) throw new ProductProjectionUnavailableError();
    const matchingRuns = runs.filter((run) => run.taskId === executionTaskId);
    if (matchingRuns.length === 0) throw new ProductProjectionUnavailableError();

    const events: ProductExecutionDetailEvent[] = [];
    let truncated = false;
    for (const [runIndex, run] of matchingRuns.entries()) {
      let after = 0;
      while (events.length < MAX_DETAIL_EVENTS) {
        const page = await this.runEvents.list(run.runId, after, PAGE_SIZE);
        for (const [eventIndex, event] of page.events.entries()) {
          const projected = projectRunEvent(event);
          events.push(projected);
          if (events.length >= MAX_DETAIL_EVENTS) {
            truncated =
              eventIndex < page.events.length - 1 ||
              (await hasMoreRunEvents(this.runEvents, run.runId, event.sequence)) ||
              (await hasMoreRuns(this.runEvents, matchingRuns.slice(runIndex + 1)));
            break;
          }
        }
        if (events.length >= MAX_DETAIL_EVENTS) break;
        if (page.nextCursor === null || page.nextCursor <= after) break;
        after = page.nextCursor;
      }
      if (events.length >= MAX_DETAIL_EVENTS) break;
    }

    events.sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.sequence - right.sequence,
    );
    return ProductExecutionDetailResponseSchema.parse({
      work_id: work.id,
      work_run_id: workRun.id,
      work_item_id: located.workItem.id,
      attempt_id: located.attempt.id,
      actor_id: located.workItem.actor_id,
      capture_scope: 'safe_run_events',
      truncated,
      events,
    });
  }
}

export function projectRunEvent(event: RunEvent): ProductExecutionDetailEvent {
  const eventType = typeof event.type === 'string' ? event.type : 'unknown';
  if (
    !['started', 'output', 'succeeded', 'failed', 'cancelled'].includes(
      eventType,
    )
  )
    return {
      kind: 'lifecycle',
      status: 'unknown',
      raw_type: clippedString(eventType, 128) ?? 'unknown',
      sequence: event.sequence,
      created_at: event.createdAt,
    };
  if (eventType !== 'output')
    return {
      kind: 'lifecycle',
      status: eventType,
      sequence: event.sequence,
      created_at: event.createdAt,
    };

  const payload = event.payload;
  const kind = stringValue(payload.kind);
  if (kind === 'assistant_text') {
    const text = clippedString(payload.text, 32_000);
    return text === null
      ? lifecycleEvent(event, kind)
      : {
          kind,
          text,
          sequence: event.sequence,
          created_at: event.createdAt,
        };
  }
  if (kind === 'reasoning_progress') {
    const status = payload.status;
    if (status !== 'started' && status !== 'completed')
      return lifecycleEvent(event, kind);
    return {
      kind,
      status,
      text: clippedString(payload.text, 32_000),
      sequence: event.sequence,
      created_at: event.createdAt,
    };
  }
  if (kind === 'tool_status')
    return projectTool(event, payload) ?? lifecycleEvent(event, kind);
  if (kind === 'child_timeline_item')
    return projectChild(event, payload) ?? lifecycleEvent(event, kind);
  if (kind === 'permission')
    return projectPermission(event, payload) ?? lifecycleEvent(event, kind);
  if (kind === 'usage')
    return {
      kind,
      sequence: event.sequence,
      created_at: event.createdAt,
      input_tokens: finiteNumber(payload.input_tokens),
      cached_input_tokens: finiteNumber(payload.cached_input_tokens),
      output_tokens: finiteNumber(payload.output_tokens),
      total_cost_usd: finiteNumber(payload.total_cost_usd),
      context_window_max_tokens: finiteNumber(payload.context_window_max_tokens),
      context_window_used_tokens: finiteNumber(payload.context_window_used_tokens),
    };
  return lifecycleEvent(event, kind ?? 'output');
}

async function hasMoreRunEvents(
  runEvents: Pick<RunEventRepository, 'list'>,
  runId: string,
  after: number,
): Promise<boolean> {
  const page = await runEvents.list(runId, after, 1);
  return page.events.length > 0;
}

async function hasMoreRuns(
  runEvents: Pick<RunEventRepository, 'list'>,
  runs: readonly { readonly runId: string }[],
): Promise<boolean> {
  for (const run of runs) {
    if (await hasMoreRunEvents(runEvents, run.runId, 0)) return true;
  }
  return false;
}

function lifecycleEvent(
  event: RunEvent,
  rawType: string,
): ProductExecutionDetailEvent {
  return {
    kind: 'lifecycle',
    status: 'output',
    raw_type: clippedString(rawType, 128) ?? 'output',
    sequence: event.sequence,
    created_at: event.createdAt,
  };
}

function projectTool(
  event: RunEvent,
  payload: RunEventPayload,
): ProductExecutionDetailEvent | null {
  const activityId = clippedString(payload.activity_id, 256);
  const category = payload.category;
  const status = payload.status;
  if (
    activityId === null ||
    !isToolCategory(category) ||
    !isToolStatus(status)
  )
    return null;
  return {
    kind: 'tool_status',
    sequence: event.sequence,
    created_at: event.createdAt,
    activity_id: activityId,
    category,
    status,
    label: clippedString(payload.label, 120),
    summary: clippedString(payload.summary, 2_000),
    provider: clippedString(payload.provider, 64),
    tool_name: clippedString(payload.tool_name, 256),
    detail_kind: isDetailKind(payload.detail_kind) ? payload.detail_kind : null,
    detail_text: clippedString(payload.detail_text, 12_000),
    exit_code: integerValue(payload.exit_code),
    parent_activity_id: clippedString(payload.parent_activity_id, 256),
  };
}

function projectChild(
  event: RunEvent,
  payload: RunEventPayload,
): ProductExecutionDetailEvent | null {
  const activityId = clippedString(payload.activity_id, 256);
  const parentActivityId = clippedString(payload.parent_activity_id, 256);
  const itemKind = payload.item_kind;
  const status = payload.status;
  const label = clippedString(payload.label, 120);
  const summary = clippedString(payload.summary, 2_000);
  if (
    !activityId ||
    !parentActivityId ||
    !isItemKind(itemKind) ||
    !isToolStatus(status) ||
    !label ||
    !summary
  )
    return null;
  return {
    kind: 'child_timeline_item',
    sequence: event.sequence,
    created_at: event.createdAt,
    activity_id: activityId,
    parent_activity_id: parentActivityId,
    item_kind: itemKind,
    status,
    label,
    summary,
    provider: clippedString(payload.provider, 64),
    detail_kind: isDetailKind(payload.detail_kind) ? payload.detail_kind : null,
    detail_text: clippedString(payload.detail_text, 12_000),
    exit_code: integerValue(payload.exit_code),
  };
}

function projectPermission(
  event: RunEvent,
  payload: RunEventPayload,
): ProductExecutionDetailEvent | null {
  const activityId = clippedString(payload.activity_id, 256);
  const category = payload.category;
  const status = payload.status;
  const summary = clippedString(payload.summary, 2_000);
  if (
    !activityId ||
    !isPermissionCategory(category) ||
    (status !== 'requested' && status !== 'resolved') ||
    !summary
  )
    return null;
  return {
    kind: 'permission',
    sequence: event.sequence,
    created_at: event.createdAt,
    activity_id: activityId,
    category,
    status,
    decision:
      payload.decision === 'allowed' || payload.decision === 'denied'
        ? payload.decision
        : null,
    summary,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function clippedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0
    ? Array.from(value).slice(0, max).join('')
    : null;
}
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
function integerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
const toolCategories = new Set<string>(productToolCategories);
function isToolCategory(value: unknown): value is 'shell' | 'read' | 'edit' | 'write' | 'search' | 'fetch' | 'subagent' | 'other' {
  return typeof value === 'string' && toolCategories.has(value);
}
const toolStatuses = new Set<string>(productToolStatuses);
function isToolStatus(value: unknown): value is 'running' | 'completed' | 'failed' | 'cancelled' {
  return typeof value === 'string' && toolStatuses.has(value);
}
const detailKinds = new Set<string>(productDetailKinds);
function isDetailKind(value: unknown): value is 'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch' {
  return typeof value === 'string' && detailKinds.has(value);
}
function isItemKind(value: unknown): value is 'assistant' | 'reasoning' | 'tool' {
  return value === 'assistant' || value === 'reasoning' || value === 'tool';
}
const permissionCategories = new Set<string>(productPermissionCategories);
function isPermissionCategory(value: unknown): value is 'tool' | 'plan' | 'question' | 'mode' | 'other' {
  return typeof value === 'string' && permissionCategories.has(value);
}
