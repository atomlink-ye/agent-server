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
 * The deliberately small read model used when Work state is surfaced in Chat.
 * Technical Task/Run, provider, event, and reasoning identities do not cross
 * this boundary.
 */
export interface ChatWorkCard {
  readonly workId: string;
  readonly workRef: string;
  readonly title: string;
  readonly productState: ProductState;
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
    if (
      !latestRun ||
      latestRun.rootTaskId === null ||
      latestRun.boundAt === null
    )
      return notCapturedCard(work);

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

function notCapturedCard(work: Work): ChatWorkCard {
  return {
    workId: work.id,
    workRef: work.id,
    title: work.title,
    productState: 'not_captured',
    problemKind: 'not_captured',
    attentionReason: 'not_captured',
    resultSummary: null,
    resultCaptureStatus: 'not_captured',
  };
}
