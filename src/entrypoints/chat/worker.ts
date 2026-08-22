import type { ChatDeliveryReconciler } from '../../application/chat/chat-delivery-reconciler.js';
import type { ChatDispatchRepository } from '../../application/ports/chat-dispatch-repository.js';
import type {
  StepWorker,
  WorkerStepResult,
} from '../../shared/workers/step-worker.js';

export type ChatDeliveryWorkerOptions = {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly pollIntervalMs?: number;
  readonly onError?: (failure: {
    readonly phase: 'claim' | 'deliver' | 'complete' | 'loop';
    readonly errorName: string;
    readonly error: unknown;
  }) => void;
};

type ChatWorkerRepository = Pick<ChatDispatchRepository, 'claimNext'> &
  Partial<Pick<ChatDispatchRepository, 'completeClaim' | 'releaseClaim'>>;

export class ChatDeliveryWorker implements StepWorker {
  readonly #repository: ChatWorkerRepository;
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
    repository: ChatWorkerRepository,
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

  /** Claim and reconcile at most one durable Chat activation. */
  public async step(): Promise<WorkerStepResult> {
    let dispatch;
    try {
      dispatch = await this.#repository.claimNext(
        this.#options.workerId,
        this.#options.leaseMs,
      );
    } catch (error: unknown) {
      this.report('claim', error);
      return { kind: 'idle' };
    }
    if (!dispatch) return { kind: 'idle' };

    const ownsClaimOutcome = Boolean(
      this.#repository.completeClaim && this.#repository.releaseClaim,
    );
    try {
      await this.#reconciler.reconcile(
        dispatch,
        ownsClaimOutcome ? undefined : this.#options.workerId,
      );
    } catch (error: unknown) {
      if (ownsClaimOutcome) {
        try {
          await this.#repository.releaseClaim!({
            id: dispatch.id,
            workerId: this.#options.workerId,
          });
        } catch (releaseError: unknown) {
          this.report('complete', releaseError);
        }
      }
      // One provider/materialization failure must not kill the long-lived Chat
      // worker. The durable activation remains retryable.
      this.report('deliver', error);
      return { kind: 'processed', value: dispatch };
    }

    if (ownsClaimOutcome) {
      try {
        const completed = await this.#repository.completeClaim!({
          id: dispatch.id,
          workerId: this.#options.workerId,
          publishedAt: new Date().toISOString(),
        });
        if (!completed)
          throw new Error('Chat activation delivery lease was lost.');
      } catch (error: unknown) {
        this.report('complete', error);
      }
    }
    return { kind: 'processed', value: dispatch };
  }

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const result = await this.step();
      if (result.kind === 'idle' && !this.#stopping)
        await this.delay(this.#options.pollIntervalMs);
    }
  }

  private fail(
    phase: 'claim' | 'deliver' | 'complete' | 'loop',
    error: unknown,
  ): void {
    this.#stopping = true;
    this.#running = false;
    this.report(phase, error);
  }

  private report(
    phase: 'claim' | 'deliver' | 'complete' | 'loop',
    error: unknown,
  ): void {
    try {
      this.#options.onError?.({
        phase,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        error,
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
