import type {
  ChatWorkCard,
  ChatWorkCardProjection,
} from '../product-projection/chat-work-card-projection.js';
import type { ConversationWorkLinkRepository } from '../../domain/chat/chat-work-origin-ref.js';
import type {
  WorkChatWakeStateRepository,
  WorkChatWakeWorkKey,
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
  listWorkKeys(): Promise<readonly WorkChatWakeWorkKey[]>;
}

export interface WorkChatWakeWorkerOptions {
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
  /** Readiness hook only; it must not be used to bypass the durable Chat grant. */
  readonly onEligibleTransition?: (event: {
    readonly key: WorkChatWakeWorkKey;
    readonly card: ChatWorkCard;
    readonly conversationId: string;
  }) => void | Promise<void>;
  readonly onError?: (failure: {
    readonly phase: 'poll' | 'project' | 'link' | 'ready' | 'loop';
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
}

/** Polls product cards and records each changed observed state once. */
export class WorkChatWakeWorker {
  readonly #dependencies: WorkChatWakeWorkerDependencies;
  readonly #conversationResolver: WorkChatConversationResolver;
  readonly #options: Required<Pick<WorkChatWakeWorkerOptions, 'now'>> & {
    readonly onEligibleTransition?: WorkChatWakeWorkerOptions['onEligibleTransition'];
    readonly onError?: WorkChatWakeWorkerOptions['onError'];
  } & {
    pollIntervalMs: number;
  };
  #stopping = false;
  #running = false;
  #loop: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #resolveDelay: (() => void) | null = null;

  public constructor(
    dependencies: WorkChatWakeWorkerDependencies,
    options: WorkChatWakeWorkerOptions = {},
  ) {
    this.#dependencies = dependencies;
    this.#conversationResolver = createWorkChatConversationResolver(
      dependencies.conversationWorkLinks,
    );
    this.#options = {
      now: options.now ?? (() => new Date()),
      pollIntervalMs: options.pollIntervalMs ?? 250,
      ...(options.onEligibleTransition
        ? { onEligibleTransition: options.onEligibleTransition }
        : {}),
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

  /** One poll, exposed for an entrypoint or an in-process caller. */
  public async processOnce(): Promise<boolean> {
    let workKeys: readonly WorkChatWakeWorkKey[];
    try {
      workKeys = await this.#dependencies.workSource.listWorkKeys();
    } catch (error: unknown) {
      this.fail('poll', error);
      return false;
    }

    let processed = false;
    for (const key of workKeys) {
      let card: ChatWorkCard;
      try {
        card = await this.#dependencies.projection.getByWorkId(key);
      } catch (error: unknown) {
        this.fail('project', error);
        continue;
      }

      const previous = await this.#dependencies.state.getLastObserved(key);
      if (previous === card.productState) continue;

      const conversationId = isEligibleState(card.productState)
        ? await this.resolveConversationId(key)
        : null;
      if (isEligibleState(card.productState) && !conversationId) continue;

      if (conversationId && isEligibleState(card.productState)) {
        try {
          await this.#options.onEligibleTransition?.({
            key,
            card,
            conversationId,
          });
        } catch (error: unknown) {
          this.fail('ready', error);
          continue;
        }
      }

      await this.#dependencies.state.saveObserved({
        ...key,
        state: card.productState,
        observedAt: this.#options.now().toISOString(),
      });
      processed = true;
    }
    return processed;
  }

  private async resolveConversationId(
    key: WorkChatWakeWorkKey,
  ): Promise<string | null> {
    try {
      const link = await this.#conversationResolver.resolve(key);
      return link?.conversationId ?? null;
    } catch (error: unknown) {
      this.fail('link', error);
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
    phase: 'poll' | 'project' | 'link' | 'ready' | 'loop',
    error: unknown,
  ): void {
    this.#stopping = true;
    this.#running = false;
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
  options: WorkChatWakeWorkerOptions = {},
): WorkChatWakeWorker {
  return new WorkChatWakeWorker(dependencies, options);
}
