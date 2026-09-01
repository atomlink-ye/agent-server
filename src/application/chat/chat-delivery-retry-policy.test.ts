import { describe, expect, it } from 'vitest';

import {
  ChatDeliveryRetryPolicy,
  type ChatDeliveryRetryPolicyOptions,
} from './chat-delivery-retry-policy.js';

// A mid-range draw keeps the jitter factor at exactly 1.
const policy = (
  options: ChatDeliveryRetryPolicyOptions = {},
): ChatDeliveryRetryPolicy =>
  new ChatDeliveryRetryPolicy({ random: () => 0.5, ...options });

describe('ChatDeliveryRetryPolicy', () => {
  it('grows the retry delay exponentially and caps it', () => {
    const retry = policy({ baseDelayMs: 500, maxDelayMs: 8_000 });
    const delays = [1, 2, 3, 4, 5, 6].map((attemptCount) => {
      const decision = retry.decide({
        attemptCount,
        errorName: 'ProviderError',
      });
      if (decision.kind !== 'retry') throw new Error('expected a retry');
      return decision.delayMs;
    });

    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000, 8_000]);
  });

  it('dead-letters an activation once the attempt ceiling is reached', () => {
    const retry = policy({ maxAttempts: 5 });

    expect(
      retry.decide({ attemptCount: 4, errorName: 'ProviderError' }),
    ).toMatchObject({ kind: 'retry' });
    expect(
      retry.decide({ attemptCount: 5, errorName: 'ProviderError' }),
    ).toMatchObject({
      kind: 'dead_letter',
      reason: 'attempt_limit_exhausted',
      planeUnavailable: false,
    });
  });

  it('parks an unavailable execution plane sooner than an ordinary failure', () => {
    const retry = policy({ maxAttempts: 8, planeUnavailableMaxAttempts: 3 });

    expect(
      retry.decide({
        attemptCount: 3,
        errorName: 'ProviderError',
      }),
    ).toMatchObject({ kind: 'retry' });
    expect(
      retry.decide({
        attemptCount: 3,
        errorName: 'ExecutionPlaneUnavailableError',
      }),
    ).toMatchObject({
      kind: 'dead_letter',
      reason: 'execution_plane_unavailable',
      planeUnavailable: true,
    });
  });

  it('treats the runtime translation of an unavailable plane the same way', () => {
    const retry = policy({ planeUnavailableMaxAttempts: 3 });

    expect(
      retry.decide({
        attemptCount: 1,
        errorName: 'RuntimeTurnExecutionError',
        errorCode: 'runtime_provider_unavailable',
      }),
    ).toMatchObject({ kind: 'retry', planeUnavailable: true });
    expect(
      retry.decide({
        attemptCount: 3,
        errorName: 'RuntimeTurnExecutionError',
        errorCode: 'runtime_provider_unavailable',
      }),
    ).toMatchObject({ kind: 'dead_letter' });
  });

  it('never parks a deferred activation whose chat runtime is not provisioned', () => {
    const retry = policy({ maxAttempts: 3, maxDelayMs: 30_000 });

    const decision = retry.decide({
      attemptCount: 50,
      errorName: 'ChatTurnRuntimeUnavailableError',
    });

    expect(decision).toMatchObject({ kind: 'retry', delayMs: 30_000 });
  });

  it('keeps a jittered delay inside its configured spread', () => {
    const low = new ChatDeliveryRetryPolicy({
      baseDelayMs: 1_000,
      jitterRatio: 0.2,
      random: () => 0,
    }).decide({ attemptCount: 1, errorName: 'ProviderError' });
    const high = new ChatDeliveryRetryPolicy({
      baseDelayMs: 1_000,
      jitterRatio: 0.2,
      random: () => 1,
    }).decide({ attemptCount: 1, errorName: 'ProviderError' });

    expect(low).toMatchObject({ delayMs: 800 });
    expect(high).toMatchObject({ delayMs: 1_200 });
  });
});
