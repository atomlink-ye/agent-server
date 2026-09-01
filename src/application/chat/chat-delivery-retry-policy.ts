/**
 * Pacing policy for durable Chat activation delivery.
 *
 * The delivery worker owns claim outcome; this policy owns only the decision
 * *how* a failed claim is released: with which backoff, or as a terminal parked
 * activation. Keeping it pure makes the retry interval and the attempt ceiling
 * directly assertable without timers or a database.
 */

export type ChatDeliveryDeadLetterReason =
  'attempt_limit_exhausted' | 'execution_plane_unavailable';

export interface ChatDeliveryFailure {
  /** Attempts already claimed for this activation, including the failed one. */
  readonly attemptCount: number;
  readonly errorName: string;
  /** Runtime failure code when the thrown error carries one. */
  readonly errorCode?: string | undefined;
}

export type ChatDeliveryRetryDecision =
  | {
      readonly kind: 'retry';
      readonly attemptCount: number;
      readonly delayMs: number;
      readonly planeUnavailable: boolean;
    }
  | {
      readonly kind: 'dead_letter';
      readonly attemptCount: number;
      readonly reason: ChatDeliveryDeadLetterReason;
      readonly planeUnavailable: boolean;
    };

export interface ChatDeliveryRetryPolicyOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxAttempts?: number;
  /** A plane that is down for everyone earns fewer attempts than a flake. */
  readonly planeUnavailableMaxAttempts?: number;
  /** Loop-level pause after an unavailable execution plane. */
  readonly planeCooldownMs?: number;
  readonly jitterRatio?: number;
  readonly random?: () => number;
}

const DEFAULTS = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 8,
  planeUnavailableMaxAttempts: 4,
  planeCooldownMs: 10_000,
  jitterRatio: 0.2,
} as const;

/**
 * `ExecutionPlaneUnavailableError` and its runtime translation both mean "the
 * plane could not run this turn at all", not "this one item misbehaved".
 */
const PLANE_UNAVAILABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'ExecutionPlaneUnavailableError',
  'ExecutionBindingUnavailableError',
]);

const PLANE_UNAVAILABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'runtime_provider_unavailable',
  'runtime_provider_session_missing',
]);

/**
 * An unprovisioned Agent Chat runtime is a documented deferral, not a delivery
 * defect: the activation must stay retryable until the runtime returns. It is
 * paced like every other failure but is never parked.
 */
const DEFERRAL_ERROR_NAMES: ReadonlySet<string> = new Set([
  'ChatTurnRuntimeUnavailableError',
]);

export function isExecutionPlaneUnavailableFailure(failure: {
  readonly errorName: string;
  readonly errorCode?: string | undefined;
}): boolean {
  if (PLANE_UNAVAILABLE_ERROR_NAMES.has(failure.errorName)) return true;
  return failure.errorCode
    ? PLANE_UNAVAILABLE_ERROR_CODES.has(failure.errorCode)
    : false;
}

export class ChatDeliveryRetryPolicy {
  readonly #options: Required<Omit<ChatDeliveryRetryPolicyOptions, 'random'>> &
    Pick<Required<ChatDeliveryRetryPolicyOptions>, 'random'>;

  public constructor(options: ChatDeliveryRetryPolicyOptions = {}) {
    this.#options = {
      baseDelayMs: options.baseDelayMs ?? DEFAULTS.baseDelayMs,
      maxDelayMs: options.maxDelayMs ?? DEFAULTS.maxDelayMs,
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
      planeUnavailableMaxAttempts:
        options.planeUnavailableMaxAttempts ??
        DEFAULTS.planeUnavailableMaxAttempts,
      planeCooldownMs: options.planeCooldownMs ?? DEFAULTS.planeCooldownMs,
      jitterRatio: options.jitterRatio ?? DEFAULTS.jitterRatio,
      random: options.random ?? Math.random,
    };
  }

  public get maxDelayMs(): number {
    return this.#options.maxDelayMs;
  }

  public get planeCooldownMs(): number {
    return this.#options.planeCooldownMs;
  }

  public decide(failure: ChatDeliveryFailure): ChatDeliveryRetryDecision {
    const attemptCount = Math.max(1, Math.trunc(failure.attemptCount) || 1);
    const planeUnavailable = isExecutionPlaneUnavailableFailure(failure);
    const maxAttempts = planeUnavailable
      ? Math.min(
          this.#options.planeUnavailableMaxAttempts,
          this.#options.maxAttempts,
        )
      : this.#options.maxAttempts;

    if (DEFERRAL_ERROR_NAMES.has(failure.errorName)) {
      return {
        kind: 'retry',
        attemptCount,
        delayMs: this.delayFor(attemptCount),
        planeUnavailable: false,
      };
    }

    if (attemptCount >= maxAttempts) {
      return {
        kind: 'dead_letter',
        attemptCount,
        reason: planeUnavailable
          ? 'execution_plane_unavailable'
          : 'attempt_limit_exhausted',
        planeUnavailable,
      };
    }
    return {
      kind: 'retry',
      attemptCount,
      delayMs: this.delayFor(attemptCount),
      planeUnavailable,
    };
  }

  private delayFor(attemptCount: number): number {
    const exponent = Math.min(attemptCount - 1, 30);
    const growth = this.#options.baseDelayMs * 2 ** exponent;
    const bounded = Math.min(this.#options.maxDelayMs, growth);
    const spread = this.#options.jitterRatio * (2 * this.#options.random() - 1);
    return Math.max(0, Math.round(bounded * (1 + spread)));
  }
}
