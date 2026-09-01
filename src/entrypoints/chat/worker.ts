import type { ChatDeliveryReconciler } from '../../application/chat/chat-delivery-reconciler.js';
import {
  ChatDeliveryRetryPolicy,
  type ChatDeliveryDeadLetterReason,
} from '../../application/chat/chat-delivery-retry-policy.js';
import type {
  ChatDispatch,
  ChatDispatchRepository,
} from '../../application/ports/chat-dispatch-repository.js';
import type {
  StepWorker,
  WorkerStepResult,
} from '../../shared/workers/step-worker.js';

export type ChatDeliveryWorkerPhase = 'claim' | 'deliver' | 'complete' | 'loop';

export interface ChatDeliveryWorkerFailure {
  readonly phase: ChatDeliveryWorkerPhase;
  readonly errorName: string;
  readonly error: unknown;
  readonly dispatchId?: string;
  readonly attemptCount?: number;
  readonly outcome?: 'retry' | 'dead_letter';
  readonly retryDelayMs?: number;
}

export interface ChatDeliveryWorkerDeadLetter {
  readonly dispatchId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly attemptCount: number;
  readonly reason: ChatDeliveryDeadLetterReason;
  readonly errorName: string;
  readonly parked: boolean;
}

export interface ChatDeliveryWorkerCircuitState {
  readonly state: 'open' | 'closed';
  readonly cooldownMs: number;
  readonly errorName?: string;
}

export type ChatDeliveryWorkerOptions = {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly pollIntervalMs?: number;
  readonly retryPolicy?: ChatDeliveryRetryPolicy;
  readonly onError?: (failure: ChatDeliveryWorkerFailure) => void;
  /** A parked activation must be observable, never a silent stall. */
  readonly onDeadLetter?: (event: ChatDeliveryWorkerDeadLetter) => void;
  readonly onCircuitState?: (event: ChatDeliveryWorkerCircuitState) => void;
  readonly now?: () => number;
};

type ChatWorkerRepository = Pick<ChatDispatchRepository, 'claimNext'> &
  Partial<
    Pick<
      ChatDispatchRepository,
      'completeClaim' | 'releaseClaim' | 'deadLetterClaim'
    >
  >;

export class ChatDeliveryWorker implements StepWorker {
  readonly #repository: ChatWorkerRepository;
  readonly #reconciler: Pick<ChatDeliveryReconciler, 'reconcile'>;
  readonly #options: Required<
    Pick<ChatDeliveryWorkerOptions, 'workerId' | 'leaseMs'>
  > &
    Pick<
      ChatDeliveryWorkerOptions,
      'onError' | 'onDeadLetter' | 'onCircuitState'
    > & {
      pollIntervalMs: number;
      retryPolicy: ChatDeliveryRetryPolicy;
      now: () => number;
    };
  #stopping = false;
  #running = false;
  #loop: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #resolveDelay: (() => void) | null = null;
  #circuitOpenUntilMs: number | null = null;

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
      retryPolicy: options.retryPolicy ?? new ChatDeliveryRetryPolicy(),
      now: options.now ?? (() => Date.now()),
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
    // An unavailable execution plane is down for every activation, so claiming
    // the next row cannot help until the cooldown elapses.
    if (this.circuitRemainingMs() > 0) return { kind: 'idle' };

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
      // One provider/materialization failure must not kill the long-lived Chat
      // worker. The durable activation stays retryable, but only behind a
      // backoff and a bounded attempt ceiling.
      await this.recordDeliveryFailure(dispatch, error, ownsClaimOutcome);
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
        this.report('complete', error, { dispatchId: dispatch.id });
      }
    }
    return { kind: 'processed', value: dispatch };
  }

  private async recordDeliveryFailure(
    dispatch: ChatDispatch,
    error: unknown,
    ownsClaimOutcome: boolean,
  ): Promise<void> {
    const errorName = nameOf(error);
    const decision = this.#options.retryPolicy.decide({
      attemptCount: dispatch.attemptCount ?? 1,
      errorName,
      errorCode: codeOf(error),
    });
    let parked = false;

    if (ownsClaimOutcome) {
      try {
        if (decision.kind === 'dead_letter' && this.#repository.deadLetterClaim)
          parked = await this.#repository.deadLetterClaim({
            id: dispatch.id,
            workerId: this.#options.workerId,
            reason: decision.reason,
            errorName,
          });
        else
          await this.#repository.releaseClaim!({
            id: dispatch.id,
            workerId: this.#options.workerId,
            // A repository without a parking seam still must not hot-retry.
            retryDelayMs:
              decision.kind === 'retry'
                ? decision.delayMs
                : this.#options.retryPolicy.maxDelayMs,
            errorName,
          });
      } catch (releaseError: unknown) {
        this.report('complete', releaseError, { dispatchId: dispatch.id });
      }
    }

    if (decision.planeUnavailable) this.openCircuit(errorName);
    if (decision.kind === 'dead_letter') {
      this.notifyDeadLetter({
        dispatchId: dispatch.id,
        tenantId: dispatch.tenantId,
        conversationId: dispatch.conversationId,
        attemptCount: decision.attemptCount,
        reason: decision.reason,
        errorName,
        parked,
      });
    }

    this.report('deliver', error, {
      dispatchId: dispatch.id,
      attemptCount: decision.attemptCount,
      outcome: decision.kind,
      ...(decision.kind === 'retry' ? { retryDelayMs: decision.delayMs } : {}),
    });
  }

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const result = await this.step();
      if (this.#stopping) break;
      const cooldownMs = this.circuitRemainingMs();
      if (cooldownMs > 0) await this.delay(cooldownMs);
      else if (result.kind === 'idle')
        await this.delay(this.#options.pollIntervalMs);
    }
  }

  private openCircuit(errorName: string): void {
    const cooldownMs = this.#options.retryPolicy.planeCooldownMs;
    if (cooldownMs <= 0) return;
    const alreadyOpen = this.circuitRemainingMs() > 0;
    this.#circuitOpenUntilMs = this.#options.now() + cooldownMs;
    // Log the transition once, not once per attempt.
    if (!alreadyOpen)
      this.notifyCircuit({ state: 'open', cooldownMs, errorName });
  }

  private circuitRemainingMs(): number {
    if (this.#circuitOpenUntilMs === null) return 0;
    const remaining = this.#circuitOpenUntilMs - this.#options.now();
    if (remaining > 0) return remaining;
    this.#circuitOpenUntilMs = null;
    this.notifyCircuit({ state: 'closed', cooldownMs: 0 });
    return 0;
  }

  private fail(phase: ChatDeliveryWorkerPhase, error: unknown): void {
    this.#stopping = true;
    this.#running = false;
    this.report(phase, error);
  }

  private report(
    phase: ChatDeliveryWorkerPhase,
    error: unknown,
    context: Omit<
      ChatDeliveryWorkerFailure,
      'phase' | 'errorName' | 'error'
    > = {},
  ): void {
    try {
      this.#options.onError?.({
        phase,
        errorName: nameOf(error),
        error,
        ...context,
      });
    } catch {
      /* safe reporting */
    }
  }

  private notifyDeadLetter(event: ChatDeliveryWorkerDeadLetter): void {
    try {
      this.#options.onDeadLetter?.(event);
    } catch {
      /* safe reporting */
    }
  }

  private notifyCircuit(event: ChatDeliveryWorkerCircuitState): void {
    try {
      this.#options.onCircuitState?.(event);
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

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}
