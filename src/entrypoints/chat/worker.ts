import type { ChatDeliveryReconciler } from '../../application/chat/chat-delivery-reconciler.js';
import type { ChatDispatchRepository } from '../../application/ports/chat-dispatch-repository.js';

export type ChatDeliveryWorkerOptions = {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly pollIntervalMs?: number;
  readonly onError?: (failure: {
    readonly phase: 'claim' | 'deliver' | 'loop';
    readonly errorName: string;
  }) => void;
};

export class ChatDeliveryWorker {
  readonly #repository: Pick<ChatDispatchRepository, 'claimNext'>;
  readonly #reconciler: Pick<ChatDeliveryReconciler, 'reconcile'>;
  readonly #options: Required<
    Pick<ChatDeliveryWorkerOptions, 'workerId' | 'leaseMs'>
  > &
    Pick<ChatDeliveryWorkerOptions, 'onError'> & { pollIntervalMs: number };
  #stopping = false;
  #running = false;
  #loop: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #resolveDelay: (() => void) | null = null;

  public constructor(
    repository: Pick<ChatDispatchRepository, 'claimNext'>,
    reconciler: Pick<ChatDeliveryReconciler, 'reconcile'>,
    options: ChatDeliveryWorkerOptions,
  ) {
    this.#repository = repository;
    this.#reconciler = reconciler;
    this.#options = {
      ...options,
      pollIntervalMs: options.pollIntervalMs ?? 50,
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

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const processed = await this.processOnce();
      if (!processed && !this.#stopping)
        await this.delay(this.#options.pollIntervalMs);
    }
  }

  private async processOnce(): Promise<boolean> {
    let dispatch;
    try {
      dispatch = await this.#repository.claimNext(
        this.#options.workerId,
        this.#options.leaseMs,
      );
    } catch (error: unknown) {
      this.fail('claim', error);
      return false;
    }
    if (!dispatch) return false;

    try {
      await this.#reconciler.reconcile(dispatch, this.#options.workerId);
    } catch (error: unknown) {
      this.fail('deliver', error);
    }
    return true;
  }

  private fail(
    phase: 'claim' | 'deliver' | 'loop',
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
