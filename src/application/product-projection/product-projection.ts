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
} from '../../contracts/product-projection/index.js';
import type { ExecutionEvent } from '../../contracts/product-projection/edges.js';
import type { ProductProjectionFactsSlice } from './work-projection-facts-source.js';
import type {
  ProductRunTrace,
  ProductWorkRun,
} from '../../contracts/product-projection/index.js';
import { PRODUCT_CONTRACT_STATUS } from '../../contracts/product-contract-policy.js';

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
      return ProductWorkRunResponseSchema.parse({
        contract_status: PRODUCT_CONTRACT_STATUS,
        work: toWorkResponse(loaded.work),
        work_run: toWorkRunResponse(loaded.workRun),
        capture_status: 'complete',
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
          throw new ProductProjectionUnavailableError();
        throw error;
      }
      const mappedEvents = events
        .map((event) => mapEvent(event, loaded.workRun.rootTaskId))
        .sort(compareEvents);
      const mappedEdges = [...facts.edges].sort(compareEdges);
      return ProductRunTraceResponseSchema.parse({
        contract_status: PRODUCT_CONTRACT_STATUS,
        work: toWorkResponse(loaded.work),
        work_run: toWorkRunResponse(loaded.workRun),
        capture_status: 'complete',
        ...facts.identity,
        runs: runs.map((run) => mapRun(run, loaded.workRun.rootTaskId)),
        events: mappedEvents,
        edges: mappedEdges,
      });
    },
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
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}
