import type { Work, WorkOwnerScope } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import type {
  ExecutionFactQuery,
  ExecutionRunFact,
} from '../ports/execution-fact-query.js';
import { ExecutionFactQueryError } from '../ports/execution-fact-query.js';
import type { WorkProjectionFactsSource } from './work-projection-facts-source.js';
import {
  toWorkResponse,
  toWorkRunResponse,
} from '../../contracts/product-work-commands.js';
import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
  ProductProjectionFollowUpReadsSchema,
} from '../../contracts/product-projection/index.js';
import type {
  ExecutionEvent,
  McpActivity,
} from '../../contracts/product-projection/edges.js';
import type { ProductProjectionFactsSlice } from './work-projection-facts-source.js';
import type {
  ProductRunTrace,
  ProductWorkRun,
} from '../../contracts/product-projection/index.js';
import { PRODUCT_CONTRACT_STATUS } from '../../contracts/product-contract-policy.js';
import { canonicalTeamMcpName } from '../agents/built-in-skills.js';

export interface ProductProjectionOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface ProductWorkIdentityQuery {
  findWorkById(id: string, owner: WorkOwnerScope): Promise<Work | null>;
  findWorkRunById(id: string, owner: WorkOwnerScope): Promise<WorkRun | null>;
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

  const loadFacts = async (
    loaded: LoadedProductWorkRun,
    owner: ProductProjectionOwnerScope,
  ): Promise<ProductProjectionFactsSlice> => {
    const facts = await options.workFacts.getByRootTask(
      owner,
      loaded.workRun.rootTaskId,
    );
    if (!facts) throw new ProductProjectionUnavailableError();
    return facts;
  };

  return {
    async getWorkRun(input) {
      const loaded = await load(input);
      const facts = await loadFacts(loaded, input);
      const capture = buildCaptureMetadata(loaded, facts);
      return ProductWorkRunResponseSchema.parse({
        contract_status: PRODUCT_CONTRACT_STATUS,
        work: toWorkResponse(loaded.work),
        work_run: toWorkRunResponse(loaded.workRun),
        ...capture,
        ...facts.identity,
      });
    },

    async getRunTrace(input) {
      const loaded = await load(input);
      const [facts, runs] = await Promise.all([
        loadFacts(loaded, input),
        options.executionFacts.listRunsByRootTask({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          rootTaskId: loaded.workRun.rootTaskId,
        }),
      ]);
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
      const capture = buildCaptureMetadata(loaded, facts);
      return ProductRunTraceResponseSchema.parse({
        contract_status: PRODUCT_CONTRACT_STATUS,
        work: toWorkResponse(loaded.work),
        work_run: toWorkRunResponse(loaded.workRun),
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

function buildCaptureMetadata(
  loaded: LoadedProductWorkRun,
  facts: ProductProjectionFactsSlice,
) {
  if (facts.rootTaskId !== loaded.workRun.rootTaskId)
    throw new ProductProjectionUnavailableError();
  const followUpReads = buildFollowUpReads(
    loaded.workRun.rootTaskId,
    facts.teamRunId,
  );
  return {
    projection_status: deriveCaptureStatus(
      facts.identity,
      followUpReads,
      loaded.workRun.rootTaskId,
      facts.teamRunId,
    ),
    follow_up_reads: followUpReads,
  } as const;
}

function buildFollowUpReads(rootTaskId: string, teamRunId: string) {
  const result = ProductProjectionFollowUpReadsSchema.safeParse([
    {
      id: rootTaskId,
      resource: 'root_task',
      missing_fields: ['result'],
      method: 'GET',
      path: `/api/v1/tasks/${rootTaskId}`,
      source_ref: { root_task_id: rootTaskId },
    },
    {
      id: teamRunId,
      resource: 'team_run',
      missing_fields: [
        'status',
        'phase',
        'control_state',
        'final_text',
        'stop_reason',
      ],
      method: 'GET',
      path: `/api/v1/team-runs/${teamRunId}`,
      source_ref: { team_run_id: teamRunId },
    },
  ]);
  if (!result.success) throw new ProductProjectionUnavailableError();
  return result.data;
}

function deriveCaptureStatus(
  identity: ProductProjectionFactsSlice['identity'],
  followUpReads: ReturnType<typeof buildFollowUpReads>,
  rootTaskId: string,
  teamRunId: string,
): 'internally_anchored' {
  // `internally_anchored` promises only that the projected identity collections and the
  // two remediation descriptors are present and internally anchored. It does
  // not promise that either follow-up endpoint's omitted facts are captured.
  const identityComplete =
    Array.isArray(identity.work_items) &&
    Array.isArray(identity.actors) &&
    Array.isArray(identity.messages);
  const followUpsComplete =
    ProductProjectionFollowUpReadsSchema.safeParse(followUpReads).success;
  if (!identityComplete || !followUpsComplete)
    throw new ProductProjectionUnavailableError();
  const sourceRefs = [
    ...identity.work_items.flatMap((item) => [
      item.source_refs,
      ...item.attempts.map((attempt) => attempt.source_refs),
    ]),
    ...identity.actors.map((actor) => actor.source_refs),
    ...identity.messages.map((message) => message.source_refs),
  ];
  const rootRead = followUpReads.find((read) => read.resource === 'root_task');
  const teamRead = followUpReads.find((read) => read.resource === 'team_run');
  const refsComplete =
    sourceRefs.some((refs) => refs.root_task_id === rootTaskId) &&
    sourceRefs.some((refs) => refs.team_run_id === teamRunId);
  const remediationAnchorsComplete =
    rootRead?.id === rootTaskId &&
    rootRead.path === `/api/v1/tasks/${rootTaskId}` &&
    rootRead.source_ref.root_task_id === rootTaskId &&
    teamRead?.id === teamRunId &&
    teamRead.path === `/api/v1/team-runs/${teamRunId}` &&
    teamRead.source_ref.team_run_id === teamRunId;
  if (!refsComplete || !remediationAnchorsComplete)
    throw new ProductProjectionUnavailableError();
  return 'internally_anchored';
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
  const canonicalToolName = canonicalTeamMcpName(event.toolName);
  if (
    !canonicalToolName ||
    event.provenance !== 'server_authorized_team_mcp_catalog' ||
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
      run_id: event.runId,
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
    provenance: 'server_authorized_team_mcp_catalog' as const,
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
