import type {
  ChatWorkCard,
  ChatWorkCardProjection,
} from '../product-projection/chat-work-card-projection.js';
import type {
  WorkChatWakeStateRepository,
  WorkChatWakeWorkKey,
} from './work-chat-wake-state-repository.js';

export interface WorkChatConversationLink {
  readonly conversationId: string;
  readonly agentDefinitionId: string;
  readonly activeAgentVersionId: string;
}

/** Narrow Lane 2 seam; no lookup or storage is assumed here. */
export interface WorkChatConversationResolver {
  resolve(
    input: WorkChatWakeWorkKey,
  ): Promise<readonly WorkChatConversationLink[]>;
}

export interface WorkChatWakeWorkSource {
  listWorkKeys(): Promise<readonly WorkChatWakeWorkKey[]>;
}

export interface WorkChatWakeWorkerOptions {
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
  readonly onError?: (failure: {
    readonly phase: 'poll' | 'project' | 'loop';
    readonly errorName: string;
  }) => void;
}

export interface WorkChatWakeWorkerDependencies {
  readonly workSource: WorkChatWakeWorkSource;
  readonly state: WorkChatWakeStateRepository;
  readonly projection: Pick<ChatWorkCardProjection, 'getByWorkId'>;
  /** Omit until Lane 2's conversation-link resolver is available. */
  readonly resolver?: WorkChatConversationResolver;
}

/** Polls product cards and records each changed observed state once. */
export class WorkChatWakeWorker {
  readonly #dependencies: WorkChatWakeWorkerDependencies;
  readonly #options: Required<Pick<WorkChatWakeWorkerOptions, 'now'>> & {
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
    this.#options = {
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

      await this.#dependencies.state.saveObserved({
        ...key,
        state: card.productState,
        observedAt: this.#options.now().toISOString(),
      });
      processed = true;
    }
    return processed;
  }

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const processed = await this.processOnce();
      if (!processed && !this.#stopping)
        await this.delay(this.#options.pollIntervalMs);
    }
  }

  private fail(phase: 'poll' | 'project' | 'loop', error: unknown): void {
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

export function createWorkChatWakeWorker(
  dependencies: WorkChatWakeWorkerDependencies,
  options: WorkChatWakeWorkerOptions = {},
): WorkChatWakeWorker {
  return new WorkChatWakeWorker(dependencies, options);
}
