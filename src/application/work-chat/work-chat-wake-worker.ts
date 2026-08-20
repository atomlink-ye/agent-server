import type { ConversationWorkLinkRepository } from '../../domain/chat/chat-work-origin-ref.js';
import type {
  ChatWorkCard,
  ChatWorkCardProjection,
} from '../product-projection/chat-work-card-projection.js';
import type { WorkChatWakeDeliveryPort } from './work-chat-wake-delivery.js';
import type {
  WorkChatWakeStateRepository,
  WorkChatWakeCursor,
  WorkChatWakeWorkKey,
  WorkChatWakeWorkPage,
} from './work-chat-wake-state-repository.js';

export interface WorkChatConversationLink {
  readonly conversationId: string;
}

/** Narrow adapter over Lane 2's tenant/workspace/work-scoped link repository. */
export interface WorkChatConversationResolver {
  resolve(input: WorkChatWakeWorkKey): Promise<WorkChatConversationLink | null>;
}

export function createWorkChatConversationResolver(
  links: Pick<ConversationWorkLinkRepository, 'findConversationIdByWork'>,
): WorkChatConversationResolver {
  return {
    async resolve(input) {
      const conversationId = await links.findConversationIdByWork({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workId: input.workId,
      });
      return conversationId ? { conversationId } : null;
    },
  };
}

export interface WorkChatWakeWorkSource {
  listWorkKeys(input: {
    readonly cursor: WorkChatWakeCursor | null;
    readonly limit: number;
  }): Promise<WorkChatWakeWorkPage>;
}

export interface WorkChatWakeWorkerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly candidateLimit?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
  readonly onError?: (failure: {
    readonly phase: 'scan' | 'claim' | 'deliver' | 'loop';
    readonly errorName: string;
  }) => void;
}

export interface WorkChatWakeWorkerDependencies {
  readonly workSource: WorkChatWakeWorkSource;
  readonly state: WorkChatWakeStateRepository;
  readonly projection: Pick<ChatWorkCardProjection, 'getByWorkId'>;
  readonly conversationWorkLinks: Pick<
    ConversationWorkLinkRepository,
    'findConversationIdByWork'
  >;
  /**
   * Lane 1 must supply the grant-derived idempotent append adapter. The
   * current ConversationRepository contract has no persisted delivery key, so
   * this dependency remains explicit and is not fabricated from a generic
   * callback or historical-message scan.
   */
  readonly delivery: WorkChatWakeDeliveryPort;
}

/** Polls product cards, atomically queues transitions, and drains the outbox. */
export class WorkChatWakeWorker {
  readonly #dependencies: WorkChatWakeWorkerDependencies;
  readonly #conversationResolver: WorkChatConversationResolver;
  readonly #options: Required<
    Pick<WorkChatWakeWorkerOptions, 'workerId' | 'leaseMs' | 'now'>
  > &
    Pick<WorkChatWakeWorkerOptions, 'onError'> & { pollIntervalMs: number };
  #stopping = false;
  #running = false;
  #loop: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #resolveDelay: (() => void) | null = null;
  #cursor: WorkChatWakeCursor | null = null;
  readonly #candidateLimit: number;

  public constructor(
    dependencies: WorkChatWakeWorkerDependencies,
    options: WorkChatWakeWorkerOptions,
  ) {
    this.#dependencies = dependencies;
    this.#conversationResolver = createWorkChatConversationResolver(
      dependencies.conversationWorkLinks,
    );
    const requestedLimit = options.candidateLimit ?? 50;
    this.#candidateLimit = Math.max(
      1,
      Math.min(
        100,
        Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 50,
      ),
    );
    this.#options = {
      workerId: options.workerId,
      leaseMs: options.leaseMs,
      now: options.now ?? (() => new Date()),
      pollIntervalMs: options.pollIntervalMs ?? 250,
      ...(options.onError ? { onError: options.onError } : {}),
    };
  }

  public start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#stopping = false;
    this.#loop = this.runLoop().catch((error: unknown) =>
      this.fail('loop', error),
    );
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#resolveDelay?.();
    this.#resolveDelay = null;
    await this.#loop;
    this.#loop = null;
  }

  /** One scan plus at most one claimed delivery. */
  public async processOnce(): Promise<boolean> {
    const observed = await this.scanOnce();
    let delivery;
    try {
      delivery = await this.#dependencies.state.claimPending(
        this.#options.workerId,
        this.#options.leaseMs,
      );
    } catch (error: unknown) {
      this.fail('claim', error);
      return observed;
    }
    if (!delivery) return observed;

    try {
      await this.#dependencies.delivery.deliver(delivery);
    } catch (error: unknown) {
      // Leave the lease in place. Reclaim is allowed only after it expires.
      this.report('deliver', error);
      return true;
    }

    try {
      await this.#dependencies.state.markDelivered(
        delivery.deliveryId,
        this.#options.workerId,
      );
    } catch (error: unknown) {
      this.fail('deliver', error);
    }
    return true;
  }

  private async scanOnce(): Promise<boolean> {
    let page: WorkChatWakeWorkPage;
    try {
      page = await this.#dependencies.workSource.listWorkKeys({
        cursor: this.#cursor,
        limit: this.#candidateLimit,
      });
    } catch (error: unknown) {
      this.fail('scan', error);
      return false;
    }

    let observed = false;
    for (const key of page.items) {
      let card: ChatWorkCard;
      try {
        card = await this.#dependencies.projection.getByWorkId(key);
      } catch (error: unknown) {
        this.fail('scan', error);
        continue;
      }

      const conversationId = isEligibleState(card.productState)
        ? await this.resolveConversationId(key)
        : null;
      // Do not advance a terminal/attention checkpoint until its durable link
      // exists; a later poll can then enqueue the transition.
      if (isEligibleState(card.productState) && !conversationId) continue;

      try {
        const result = await this.#dependencies.state.observe({
          key,
          card,
          conversationId,
          observedAt: this.#options.now().toISOString(),
        });
        if (result !== 'unchanged') observed = true;
      } catch (error: unknown) {
        this.fail('scan', error);
        break;
      }
    }
    this.#cursor = page.nextCursor;
    return observed;
  }

  private async resolveConversationId(
    key: WorkChatWakeWorkKey,
  ): Promise<string | null> {
    try {
      const link = await this.#conversationResolver.resolve(key);
      return link?.conversationId ?? null;
    } catch (error: unknown) {
      this.fail('scan', error);
      return null;
    }
  }

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const processed = await this.processOnce();
      if (!processed && !this.#stopping)
        await this.delay(this.#options.pollIntervalMs);
    }
  }

  private fail(
    phase: 'scan' | 'claim' | 'deliver' | 'loop',
    error: unknown,
  ): void {
    this.#stopping = true;
    this.#running = false;
    this.report(phase, error);
  }

  private report(
    phase: 'scan' | 'claim' | 'deliver' | 'loop',
    error: unknown,
  ): void {
    try {
      this.#options.onError?.({
        phase,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    } catch {
      /* safe reporting */
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#resolveDelay = () => {
        this.#resolveDelay = null;
        resolve();
      };
      const timer = setTimeout(() => {
        if (this.#timer === timer) this.#timer = null;
        this.#resolveDelay?.();
      }, ms);
      timer.unref?.();
      this.#timer = timer;
    });
  }
}

function isEligibleState(
  state: ChatWorkCard['productState'],
): state is 'complete' | 'needs_you' | 'problem' {
  return state === 'complete' || state === 'needs_you' || state === 'problem';
}

export function createWorkChatWakeWorker(
  dependencies: WorkChatWakeWorkerDependencies,
  options: WorkChatWakeWorkerOptions,
): WorkChatWakeWorker {
  return new WorkChatWakeWorker(dependencies, options);
}
