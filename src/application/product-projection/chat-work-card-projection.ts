import type { Work, WorkOwnerScope } from '../../domain/work/work.js';
import {
  ProductWorkRunSuccessSchema,
  type ProductState,
} from '../../contracts/product-projection/index.js';
import type {
  ProductProjectionApi,
  ProductWorkIdentityQuery,
} from './product-projection.js';

/**
 * A Chat card is a handle on a Work, not on a Run, so it has two stages a Run
 * state cannot name: a Work that exists but has never been run, and a Run that
 * has been requested but is not yet bound to its root Task. Both were once
 * reported as `not_captured`, which reads as "we could not read the status" —
 * a failure — when in fact the status was read perfectly and the Work simply
 * had not started. `not_captured` now means only what it says.
 */
export type ChatWorkCardState = ProductState | 'not_started' | 'starting';

/**
 * The deliberately small read model used when Work state is surfaced in Chat.
 * Technical Task/Run, provider, event, and reasoning identities do not cross
 * this boundary.
 */
export interface ChatWorkCard {
  readonly workId: string;
  readonly workRef: string;
  readonly title: string;
  readonly productState: ChatWorkCardState;
  readonly problemKind: 'failed' | 'cancelled' | 'not_captured' | null;
  readonly attentionReason:
    'completion_approval_pending' | 'not_captured' | null;
  readonly resultSummary: string | null;
  readonly resultCaptureStatus:
    'present' | 'not_present' | 'redacted' | 'not_captured';
}

export interface ChatWorkCardProjectionOptions {
  readonly workIdentity: ProductWorkIdentityQuery;
  readonly productProjection: Pick<ProductProjectionApi, 'getWorkRun'>;
}

export interface ChatWorkCardInput extends WorkOwnerScope {
  readonly workId: string;
}

/** WorkId-entry adapter over the canonical ProductProjection status derivation. */
export class ChatWorkCardProjection {
  public constructor(private readonly options: ChatWorkCardProjectionOptions) {}

  public async getByWorkId(input: ChatWorkCardInput): Promise<ChatWorkCard> {
    const owner = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
    };
    const work = await this.options.workIdentity.findWorkById(
      input.workId,
      owner,
    );
    if (!work) throw new ChatWorkCardNotFoundError();

    const latestRun = await this.options.workIdentity.findLatestVisibleWorkRun(
      work.id,
      owner,
    );
    // A Work with no Run at all has not failed to report anything: it is
    // waiting to be started. A Run that exists but is not yet bound to its
    // root Task is starting. Neither is a status-read failure.
    if (!latestRun) return stageCard(work, 'not_started');
    if (latestRun.rootTaskId === null || latestRun.boundAt === null)
      return stageCard(work, 'starting');

    const response = await this.options.productProjection.getWorkRun({
      ...owner,
      workId: work.id,
      workRunId: latestRun.id,
    });
    const parsed = ProductWorkRunSuccessSchema.safeParse(response);
    if (!parsed.success) throw new ChatWorkCardUnavailableError();
    const detail = parsed.data.work_run;
    return {
      workId: work.id,
      workRef: work.id,
      title: work.title,
      productState: detail.product_state,
      problemKind: detail.problem_kind,
      attentionReason: detail.attention_reason,
      resultSummary: detail.result_summary,
      resultCaptureStatus: detail.result_capture_status,
    };
  }
}

export function createChatWorkCardProjection(
  options: ChatWorkCardProjectionOptions,
): ChatWorkCardProjection {
  return new ChatWorkCardProjection(options);
}

export class ChatWorkCardNotFoundError extends Error {
  public readonly code = 'work_not_found';

  public constructor() {
    super('The Work was not found for the requested workspace.');
    this.name = 'ChatWorkCardNotFoundError';
  }
}

export class ChatWorkCardUnavailableError extends Error {
  public readonly code = 'projection_unavailable';

  public constructor() {
    super('The Work Chat card projection is temporarily unavailable.');
    this.name = 'ChatWorkCardUnavailableError';
  }
}

/**
 * A Work that has not produced a result yet has no result to report, which is
 * `not_present`. Reporting `not_captured` here claimed we had tried to read a
 * result and could not.
 */
function stageCard(
  work: Work,
  productState: 'not_started' | 'starting',
): ChatWorkCard {
  return {
    workId: work.id,
    workRef: work.id,
    title: work.title,
    productState,
    problemKind: null,
    attentionReason: null,
    resultSummary: null,
    resultCaptureStatus: 'not_present',
  };
}
