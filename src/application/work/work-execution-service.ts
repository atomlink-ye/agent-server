import type { AccessContext } from '../../platform/access-context.js';
import type { Work } from '../../domain/work/work.js';
import { WorkNotFoundError } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import type { ProductProjectionApi } from '../product-projection/product-projection.js';
import type {
  StartWorkRun,
  StartWorkRunRequest,
  StartWorkRunResult,
} from './start-work-run.js';
import { WorkIdentityApi } from './work-identity-api.js';

export type WorkExecutionProductState =
  | 'not_started'
  | 'running'
  | 'needs_you'
  | 'complete'
  | 'problem'
  | 'not_captured';

export interface WorkExecutionArtifactRef {
  readonly ref: string;
  readonly kind: string;
}

export interface WorkExecutionReceipt {
  readonly work: Work;
  readonly workRun: WorkRun;
  readonly executionReceipt: StartWorkRunResult['executionReceipt'];
}

/**
 * Product-level execution view. Task / Run identities deliberately stay out of
 * this object; technical trace APIs remain available separately.
 */
export interface WorkExecutionView {
  readonly work: Work;
  readonly currentWorkRun: WorkRun | null;
  readonly productState: WorkExecutionProductState;
  readonly resultSummary: string | null;
  readonly artifacts: readonly WorkExecutionArtifactRef[];
}

/**
 * High-level Work orchestration. It preserves Work/WorkRun/Task/Run as
 * separate aggregates while keeping product features off those technical
 * seams for ordinary start/continue/state operations.
 */
export class WorkExecutionService {
  public constructor(
    private readonly identity: Pick<
      WorkIdentityApi,
      'findWorkById' | 'findLatestWorkRun'
    >,
    private readonly starter: Pick<StartWorkRun, 'execute'>,
    private readonly projection: Pick<ProductProjectionApi, 'getWorkListItem'>,
  ) {}

  public async startWork(
    input: StartWorkRunRequest,
  ): Promise<WorkExecutionReceipt> {
    return this.startExistingWork(input);
  }

  /** Source-compatible boundary used while existing HTTP/MCP handlers migrate. */
  public async startExistingWork(
    input: StartWorkRunRequest,
  ): Promise<WorkExecutionReceipt> {
    const owner = WorkIdentityApi.ownerFromAccessContext(input.accessContext);
    const work = await this.identity.findWorkById(input.workId, owner);
    if (!work) throw new WorkNotFoundError();
    const started = await this.starter.execute(input);
    return {
      work,
      workRun: started.workRun,
      executionReceipt: started.executionReceipt,
    };
  }

  public async continueWork(input: {
    readonly accessContext: AccessContext;
    readonly workId: string;
    readonly feedback: string;
  }): Promise<WorkExecutionReceipt> {
    const owner = WorkIdentityApi.ownerFromAccessContext(input.accessContext);
    const work = await this.identity.findWorkById(input.workId, owner);
    if (!work) throw new WorkNotFoundError();
    const predecessor = await this.identity.findLatestWorkRun(work.id, owner);
    if (!predecessor) throw new WorkNotFoundError();
    return this.startExistingWork({
      accessContext: input.accessContext,
      workId: work.id,
      triggerKind: 'manual',
      predecessorWorkRunId: predecessor.id,
      input: { feedback: input.feedback },
    });
  }

  public async getWorkState(input: {
    readonly accessContext: AccessContext;
    readonly workId: string;
  }): Promise<WorkExecutionView> {
    const owner = WorkIdentityApi.ownerFromAccessContext(input.accessContext);
    const work = await this.identity.findWorkById(input.workId, owner);
    if (!work) throw new WorkNotFoundError();
    const currentWorkRun = await this.identity.findLatestWorkRun(
      work.id,
      owner,
    );
    if (!currentWorkRun) {
      return Object.freeze({
        work,
        currentWorkRun: null,
        productState: 'not_started' as const,
        resultSummary: null,
        artifacts: Object.freeze([]),
      });
    }
    const projected = await this.projection.getWorkListItem({
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      work,
    });
    return Object.freeze({
      work,
      currentWorkRun,
      productState: projected.product_state,
      resultSummary: projected.latest_run_summary?.result_summary ?? null,
      // Artifact records are a later product slice. The facade owns the
      // stable location now instead of leaking runtime artifact internals.
      artifacts: Object.freeze([]),
    });
  }
}
