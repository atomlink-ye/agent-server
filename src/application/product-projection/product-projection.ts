import type { Work, WorkOwnerScope } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import type {
  ExecutionFactQuery,
  ExecutionRunFact,
} from '../ports/execution-fact-query.js';
import { ExecutionFactQueryError } from '../ports/execution-fact-query.js';
import type { WorkProjectionFactsSource } from './work-projection-facts-source.js';
import {
  GetWorkResponseSchema,
  WorkListItemSchema,
  toWorkResponse,
  toWorkRunResponse,
} from '../../contracts/product-work-commands.js';
import type {
  GetWorkResponse,
  WorkListItem,
} from '../../contracts/product-work-commands.js';
import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from '../../contracts/product-projection/index.js';
import type {
  ExecutionEvent,
  McpActivity,
} from '../../contracts/product-projection/edges.js';
import { SERVER_AUTHORIZED_TEAM_MCP_CATALOG } from '../../contracts/product-projection/edges.js';
import type {
  ProductProjectionDurableFacts,
  ProductProjectionFactsSlice,
} from './work-projection-facts-source.js';
import type {
  ProductRunTrace,
  ProductWorkRun,
} from '../../contracts/product-projection/index.js';
import { canonicalCollaborationMcpName } from '../../domain/collaboration/canonical-collaboration-tools.js';

export interface ProductProjectionOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface ProductWorkIdentityQuery {
  findWorkById(id: string, owner: WorkOwnerScope): Promise<Work | null>;
  findWorkRunById(id: string, owner: WorkOwnerScope): Promise<WorkRun | null>;
  findLatestVisibleWorkRun(
    workId: string,
    owner: WorkOwnerScope,
  ): Promise<WorkRun | null>;
}

export type WorkIdentityQuery = ProductWorkIdentityQuery;

export interface ProductProjectionOptions {
  readonly workIdentity: ProductWorkIdentityQuery;
  readonly workFacts: Pick<WorkProjectionFactsSource, 'getByRootTask'>;
  readonly executionFacts: ExecutionFactQuery;
  readonly now?: () => Date;
}

export class ProductProjectionNotFoundError extends Error {
  public readonly code = 'work_run_not_found';

  public constructor() {
    super('The WorkRun was not found for the requested workspace.');
    this.name = 'ProductProjectionNotFoundError';
  }
}

export class ProductProjectionUnavailableError extends Error {
  public readonly code = 'projection_unavailable';

  public constructor() {
    super('The WorkRun projection is temporarily unavailable.');
    this.name = 'ProductProjectionUnavailableError';
  }
}

export class ProductProjectionInvalidError extends Error {
  public readonly code = 'projection_invalid';

  public constructor(
    public readonly reason: 'event_page_limit' | 'event_page_order_invalid',
  ) {
    super(`The WorkRun projection is invalid: ${reason}.`);
    this.name = 'ProductProjectionInvalidError';
  }
}

interface LoadedProductWorkRun {
  readonly work: Work;
  readonly workRun: WorkRun & {
    readonly rootTaskId: string;
    readonly boundAt: string;
  };
}

export interface ProductProjectionApi {
  getWork(
    input: ProductProjectionOwnerScope & { workId: string },
  ): Promise<GetWorkResponse>;
  getWorkListItem(
    input: ProductProjectionOwnerScope & { work: Work },
  ): Promise<WorkListItem>;
  getWorkRun(
    input: ProductProjectionOwnerScope & { workId: string; workRunId: string },
  ): Promise<ProductWorkRun>;
  getRunTrace(
    input: ProductProjectionOwnerScope & { workId: string; workRunId: string },
  ): Promise<ProductRunTrace>;
}

export function createProductProjection(
  options: ProductProjectionOptions,
): ProductProjectionApi {
  const load = async (
    input: ProductProjectionOwnerScope & { workId: string; workRunId: string },
  ): Promise<LoadedProductWorkRun> => {
    const owner = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
    };
    const work = await options.workIdentity.findWorkById(input.workId, owner);
    const workRun = await options.workIdentity.findWorkRunById(
      input.workRunId,
      owner,
    );
    if (
      !work ||
      !workRun ||
      workRun.workId !== work.id ||
      workRun.rootTaskId === null ||
      workRun.boundAt === null
    )
      throw new ProductProjectionNotFoundError();
    return { work, workRun: workRun as LoadedProductWorkRun['workRun'] };
  };

  const loadFactsAndRuns = async (
    loaded: LoadedProductWorkRun,
    owner: ProductProjectionOwnerScope,
  ) => {
    const runs = await options.executionFacts.listRunsByRootTask({
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      rootTaskId: loaded.workRun.rootTaskId,
    });
    if (runs.length === 0) throw new ProductProjectionUnavailableError();
    const collaborativeFacts = await options.workFacts.getByRootTask(
      owner,
      loaded.workRun.rootTaskId,
    );
    const facts =
      collaborativeFacts ??
      singleAgentProjectionFacts(loaded.workRun.rootTaskId, runs);
    return { facts: applyExecutionTiming(facts, runs), runs };
  };

  return {
    async getWork(input) {
      const work = await options.workIdentity.findWorkById(input.workId, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      });
      if (!work) throw new ProductProjectionNotFoundError();
      return GetWorkResponseSchema.parse({ work: toWorkResponse(work) });
    },
    async getWorkListItem(input) {
      if (
        input.work.tenantId !== input.tenantId ||
        input.work.workspaceId !== input.workspaceId
      )
        throw new ProductProjectionNotFoundError();
      const owner = {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      };
      const latestRun = await options.workIdentity.findLatestVisibleWorkRun(
        input.work.id,
        owner,
      );
      let productState: WorkListItem['product_state'] = 'not_captured';
      let latestRunSummary: WorkListItem['latest_run_summary'] = latestRun
        ? {
            id: latestRun.id,
            updated_at: latestRun.updatedAt,
            result_summary: null,
            result_capture_status: 'not_captured',
          }
        : null;
      if (
        latestRun &&
        latestRun.rootTaskId !== null &&
        latestRun.boundAt !== null
      ) {
        try {
          const loaded = {
            work: input.work,
            workRun: latestRun as LoadedProductWorkRun['workRun'],
          };
          const { facts, runs } = await loadFactsAndRuns(loaded, owner);
          const detail = buildWorkRunDetail(loaded, facts.product, runs);
          productState = detail.product_state;
          latestRunSummary = {
            id: latestRun.id,
            updated_at: latestRun.updatedAt,
            result_summary: detail.result_summary,
            result_capture_status: detail.result_capture_status,
          };
        } catch (error) {
          if (!(error instanceof ProductProjectionUnavailableError))
            throw error;
        }
      }
      return WorkListItemSchema.parse({
        ...toWorkResponse(input.work),
        product_state: productState,
        latest_run_summary: latestRunSummary,
      });
    },
    async getWorkRun(input) {
      const loaded = await load(input);
      const { facts, runs } = await loadFactsAndRuns(loaded, input);
      const capture = buildCaptureMetadata(loaded, facts, runs);
      return ProductWorkRunResponseSchema.parse({
        work: toWorkResponse(loaded.work),
        work_run: buildWorkRunDetail(loaded, facts.product, runs),
        ...capture,
        ...facts.identity,
      });
    },

    async getRunTrace(input) {
      const loaded = await load(input);
      const { facts, runs } = await loadFactsAndRuns(loaded, input);
      let events;
      try {
        events = await options.executionFacts.listRunEvents({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          runIds: runs.map((run) => run.runId),
        });
      } catch (error) {
        if (error instanceof ExecutionFactQueryError)
          throw new ProductProjectionInvalidError(error.reason);
        throw error;
      }
      const mappedEvents = events
        .map((event) => mapEvent(event, loaded.workRun.rootTaskId))
        .sort(compareEvents);
      const mappedEdges = [...facts.edges].sort(compareEdges);
      const capture = buildCaptureMetadata(loaded, facts, runs);
      return ProductRunTraceResponseSchema.parse({
        work: toWorkResponse(loaded.work),
        work_run: buildWorkRunDetail(loaded, facts.product, runs),
        ...capture,
        ...facts.identity,
        runs: runs.map((run) => mapRun(run, loaded.workRun.rootTaskId)),
        events: mappedEvents,
        edges: mappedEdges,
        mcp_activities: events
          .map((event) => mapMcpActivity(event, loaded.workRun.rootTaskId))
          .filter((activity): activity is McpActivity => activity !== null)
          .sort(compareMcpActivities),
        timeline_coverage: timelineCoverage(),
      });
    },
  };
}

function singleAgentProjectionFacts(
  rootTaskId: string,
  runs: readonly ExecutionRunFact[],
): ProductProjectionFactsSlice {
  const failed = runs.some(
    (run) =>
      run.status === 'failed' ||
      run.status === 'timed_out' ||
      run.status === 'cancelled',
  );
  const complete =
    runs.length > 0 && runs.every((run) => run.status === 'succeeded');
  return {
    rootTaskId,
    teamRunId: null,
    identity: { work_items: [], actors: [], messages: [] },
    edges: [],
    product: {
      status: failed ? 'failed' : complete ? 'succeeded' : 'active',
      phase: failed ? 'failed' : complete ? 'done' : 'active',
      revision: 0,
      completionApprovalRequired: false,
      completionRequestedByRunId: null,
      approvalAccepted: false,
      finalText: null,
      finalTextPresent: false,
    },
  };
}

function buildCaptureMetadata(
  loaded: LoadedProductWorkRun,
  facts: ProductProjectionFactsSlice,
  runs: readonly ExecutionRunFact[],
) {
  if (facts.rootTaskId !== loaded.workRun.rootTaskId)
    throw new ProductProjectionUnavailableError();
  if (facts.teamRunId === null) {
    if (
      runs.length === 0 ||
      runs.some((run) => run.rootTaskId !== loaded.workRun.rootTaskId)
    )
      throw new ProductProjectionUnavailableError();
    return { projection_status: 'internally_anchored' as const };
  }
  return {
    projection_status: deriveCaptureStatus(
      facts.identity,
      loaded.workRun.rootTaskId,
      facts.teamRunId,
    ),
  } as const;
}

function deriveCaptureStatus(
  identity: ProductProjectionFactsSlice['identity'],
  rootTaskId: string,
  teamRunId: string,
): 'internally_anchored' {
  // `internally_anchored` promises only that the projected identity collections
  // contain durable source references for both aggregate identities.
  const identityComplete =
    Array.isArray(identity.work_items) &&
    Array.isArray(identity.actors) &&
    Array.isArray(identity.messages);
  if (!identityComplete) throw new ProductProjectionUnavailableError();
  const sourceRefs = [
    ...identity.work_items.flatMap((item) => [
      item.source_refs,
      ...item.attempts.map((attempt) => attempt.source_refs),
    ]),
    ...identity.actors.map((actor) => actor.source_refs),
    ...identity.messages.map((message) => message.source_refs),
  ];
  const refsComplete =
    sourceRefs.some((refs) => refs.root_task_id === rootTaskId) &&
    sourceRefs.some((refs) => refs.team_run_id === teamRunId);
  if (!refsComplete) throw new ProductProjectionUnavailableError();
  return 'internally_anchored';
}

function buildWorkRunDetail(
  loaded: LoadedProductWorkRun,
  product: ProductProjectionDurableFacts,
  runs: readonly ExecutionRunFact[],
) {
  const summary = toWorkRunResponse(loaded.workRun);
  const state = deriveProductState(product, runs);
  const result = deriveProductResult(product);
  if (state === 'not_captured')
    return {
      ...summary,
      product_state: 'not_captured' as const,
      problem_kind: 'not_captured' as const,
      attention_reason: 'not_captured' as const,
      ...result,
      control_revision: null,
      cancel_availability: 'not_captured' as const,
      completion_decision_availability: 'not_captured' as const,
    };

  const approvalPending = isApprovalPending(product);
  return {
    ...summary,
    product_state: state,
    problem_kind: state === 'problem' ? ('failed' as const) : null,
    attention_reason: approvalPending
      ? ('completion_approval_pending' as const)
      : null,
    ...result,
    control_revision: product.revision,
    // OI-33 cancellation controls are not part of this projection slice.
    cancel_availability: 'not_captured' as const,
    completion_decision_availability: approvalPending
      ? ('available' as const)
      : ('not_available' as const),
  };
}

function deriveProductState(
  product: ProductProjectionDurableFacts,
  runs: readonly ExecutionRunFact[],
): 'running' | 'needs_you' | 'complete' | 'problem' | 'not_captured' {
  if (hasProductFactConflict(product, runs)) return 'not_captured';
  if (isApprovalPending(product)) return 'needs_you';
  if (
    product.status === 'succeeded' &&
    product.phase === 'done' &&
    approvalSatisfied(product)
  )
    return 'complete';
  if (
    product.status === 'failed' ||
    runs.some((run) => run.status === 'failed' || run.status === 'timed_out')
  )
    return 'problem';
  if (product.status === 'active' || product.status === 'waiting')
    return 'running';
  if (
    runs.some(
      (run) => run.status === 'running' || run.status === 'waiting_children',
    )
  )
    return 'running';
  return 'not_captured';
}

function deriveProductResult(product: ProductProjectionDurableFacts) {
  if (product.finalTextPresent !== (product.finalText !== null))
    return {
      result_summary: null,
      result_capture_status: 'not_captured' as const,
    };
  return {
    result_summary: product.finalTextPresent ? product.finalText : null,
    result_capture_status: product.finalTextPresent
      ? ('present' as const)
      : ('not_present' as const),
  };
}

function hasProductFactConflict(
  product: ProductProjectionDurableFacts,
  _runs: readonly ExecutionRunFact[],
): boolean {
  if (
    product.status === null ||
    product.phase === null ||
    product.revision === null ||
    product.completionApprovalRequired === null
  )
    return true;
  if (product.finalTextPresent !== (product.finalText !== null)) return true;
  return (
    product.completionApprovalRequired === true &&
    product.approvalAccepted &&
    product.completionRequestedByRunId === null
  );
}

function isApprovalPending(product: ProductProjectionDurableFacts): boolean {
  return (
    product.completionApprovalRequired === true &&
    product.completionRequestedByRunId !== null &&
    !product.approvalAccepted
  );
}

function approvalSatisfied(product: ProductProjectionDurableFacts): boolean {
  return (
    product.completionApprovalRequired === false || product.approvalAccepted
  );
}

function applyExecutionTiming(
  facts: ProductProjectionFactsSlice,
  runs: readonly ExecutionRunFact[],
): ProductProjectionFactsSlice {
  const runsByTask = new Map<string, ExecutionRunFact[]>();
  for (const run of runs) {
    const bucket = runsByTask.get(run.taskId) ?? [];
    bucket.push(run);
    runsByTask.set(run.taskId, bucket);
  }
  return {
    ...facts,
    identity: {
      ...facts.identity,
      work_items: facts.identity.work_items.map((item) => ({
        ...item,
        attempts: item.attempts.map((attempt) => {
          const taskId = attempt.source_refs.task_id;
          const taskRuns = taskId ? (runsByTask.get(taskId) ?? []) : [];
          return { ...attempt, ...attemptTimingForRuns(taskRuns) };
        }),
      })),
    },
  };
}

export function attemptTimingForRuns(runs: readonly ExecutionRunFact[]) {
  if (runs.length !== 1)
    return {
      started_at: null,
      ended_at: null,
      duration_ms: null,
      timing_capture_status: 'not_captured' as const,
    };
  const run = runs[0]!;
  const startedAt = run.startedAt;
  const endedAt = run.endedAt;
  const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const endMs = endedAt ? new Date(endedAt).getTime() : NaN;
  return {
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms:
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, endMs - startMs)
        : null,
    timing_capture_status: 'captured' as const,
  };
}

function mapEvent(
  event: Awaited<ReturnType<ExecutionFactQuery['listRunEvents']>>[number],
  rootTaskId: string,
): ExecutionEvent {
  return {
    sequence: event.sequence,
    type: event.type,
    payload_capture_status: event.payloadPresent ? 'redacted' : 'not_present',
    source_refs: { root_task_id: rootTaskId, run_id: event.runId },
    created_at: event.createdAt,
  };
}

function mapMcpActivity(
  event: Awaited<ReturnType<ExecutionFactQuery['listRunEvents']>>[number],
  rootTaskId: string,
): McpActivity | null {
  if (
    !event.activityId ||
    event.activityKind !== 'tool_status' ||
    !event.taskId
  )
    return null;
  const canonicalToolName = canonicalCollaborationMcpName(event.toolName);
  if (
    !canonicalToolName ||
    event.provenance !== SERVER_AUTHORIZED_TEAM_MCP_CATALOG ||
    event.toolIdentityCaptureStatus !== 'present'
  )
    return null;
  const sourceRefs = {
    root_task_id: event.rootTaskId || rootTaskId,
    task_id: event.taskId,
    run_id: event.runId,
    ...(event.actorId ? { actor_id: event.actorId } : {}),
    ...(event.workItemId ? { work_item_id: event.workItemId } : {}),
  };
  const chatDetail = {
    method: 'GET' as const,
    path: `/api/v1/runs/${event.runId}/events?after=${event.sequence - 1}`,
    target: {
      source_refs: { run_id: event.runId },
      sequence: event.sequence,
      activity_id: event.activityId,
    },
  };
  const common = {
    activity_id: event.activityId,
    sequence: event.sequence,
    operation_capture_status: 'not_present' as const,
    result_capture_status:
      event.responseObserved === true
        ? ('redacted' as const)
        : ('not_present' as const),
    source_refs: sourceRefs,
    chat_detail: chatDetail,
    provenance: SERVER_AUTHORIZED_TEAM_MCP_CATALOG,
    tool_identity_capture_status: 'present' as const,
  };
  if (event.activityKind === 'tool_status') {
    if (
      !isToolActivityStatus(event.activityStatus) ||
      !isToolActivityCategory(event.activityCategory)
    )
      return null;
    return {
      ...common,
      kind: 'tool_status',
      status: event.activityStatus,
      category: event.activityCategory,
      tool_name: canonicalToolName,
    };
  }
  return null;
}

function isToolActivityStatus(
  value: string | null,
): value is 'running' | 'completed' | 'failed' | 'cancelled' {
  return (
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function isToolActivityCategory(
  value: string | null,
): value is
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'fetch'
  | 'subagent'
  | 'other' {
  return (
    value === 'shell' ||
    value === 'read' ||
    value === 'edit' ||
    value === 'write' ||
    value === 'search' ||
    value === 'fetch' ||
    value === 'subagent' ||
    value === 'other'
  );
}

function compareMcpActivities(left: McpActivity, right: McpActivity): number {
  return (
    left.source_refs.run_id.localeCompare(right.source_refs.run_id) ||
    left.sequence - right.sequence ||
    left.activity_id.localeCompare(right.activity_id)
  );
}

function timelineCoverage() {
  return {
    scope: 'mcp_dispatch_and_confirmation' as const,
    completeness: 'mcp_only' as const,
    excluded_execution: [
      'direct_shell',
      'direct_file_edit',
      'other_non_mcp_execution',
    ] as const,
  };
}

function compareEvents(left: ExecutionEvent, right: ExecutionEvent): number {
  return (
    left.created_at.localeCompare(right.created_at) ||
    left.source_refs.run_id!.localeCompare(right.source_refs.run_id!) ||
    left.sequence - right.sequence
  );
}

function compareEdges(
  left: {
    source_created_at: string;
    source_refs: { team_run_id: string };
    sequence?: number;
  },
  right: {
    source_created_at: string;
    source_refs: { team_run_id: string };
    sequence?: number;
  },
): number {
  return (
    left.source_created_at.localeCompare(right.source_created_at) ||
    left.source_refs.team_run_id.localeCompare(right.source_refs.team_run_id) ||
    (left.sequence ?? 0) - (right.sequence ?? 0)
  );
}

function mapRun(run: ExecutionRunFact, rootTaskId: string) {
  return {
    status: run.status,
    provider: run.provider,
    model: run.model,
    result_capture_status: run.resultPresent ? 'redacted' : 'not_present',
    error_code: run.errorCode,
    source_refs: {
      root_task_id: rootTaskId,
      task_id: run.taskId,
      run_id: run.runId,
    },
    actor_id: run.actorId ?? null,
    work_item_id: run.workItemId ?? null,
    started_at: run.startedAt ?? null,
    ended_at: run.endedAt ?? null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}
