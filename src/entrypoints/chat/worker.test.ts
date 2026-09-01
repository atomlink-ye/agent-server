import { describe, expect, it } from 'vitest';

import { ChatDeliveryRetryPolicy } from '../../application/chat/chat-delivery-retry-policy.js';
import { ExecutionPlaneUnavailableError } from '../../application/ports/execution-plane.js';
import type { ChatDispatch } from '../../application/ports/chat-dispatch-repository.js';
import {
  ChatDeliveryWorker,
  type ChatDeliveryWorkerCircuitState,
  type ChatDeliveryWorkerDeadLetter,
  type ChatDeliveryWorkerFailure,
} from './worker.js';

const workerId = 'worker-a:chat';

/**
 * Durable-queue double: one activation whose claimability is driven by the same
 * available-at / dead-letter state the Postgres repository maintains.
 */
class FakeDispatchQueue {
  public attemptCount = 0;
  public availableAtMs = 0;
  public publishedAt: string | null = null;
  public deadLetter: {
    readonly reason: string;
    readonly errorName?: string;
  } | null = null;
  public readonly releases: Array<{
    readonly retryDelayMs?: number;
    readonly errorName?: string;
  }> = [];

  public constructor(private readonly clock: { now: number }) {}

  public claimNext = async (
    claimant: string,
    _leaseMs: number,
  ): Promise<ChatDispatch | null> => {
    if (this.publishedAt || this.deadLetter) return null;
    if (this.clock.now < this.availableAtMs) return null;
    this.claimedBy = claimant;
    this.attemptCount += 1;
    return Object.freeze({
      id: 'dispatch-1',
      tenantId: 'tenant-a',
      agentDefinitionId: 'agent-a',
      conversationId: 'conversation-a',
      throughSequence: 1,
      dedupeKey: 'message:1',
      attemptCount: this.attemptCount,
      createdAt: '2026-09-01T00:00:00.000Z',
      publishedAt: null,
    });
  };

  public completeClaim = async (input: {
    readonly workerId: string;
    readonly publishedAt: string;
  }): Promise<boolean> => {
    if (this.claimedBy !== input.workerId) return false;
    this.publishedAt = input.publishedAt;
    this.claimedBy = null;
    return true;
  };

  public releaseClaim = async (input: {
    readonly workerId: string;
    readonly retryDelayMs?: number;
    readonly errorName?: string;
  }): Promise<boolean> => {
    if (this.claimedBy !== input.workerId) return false;
    this.claimedBy = null;
    this.availableAtMs = this.clock.now + (input.retryDelayMs ?? 0);
    this.releases.push({
      ...(input.retryDelayMs === undefined
        ? {}
        : { retryDelayMs: input.retryDelayMs }),
      ...(input.errorName === undefined ? {} : { errorName: input.errorName }),
    });
    return true;
  };

  public deadLetterClaim = async (input: {
    readonly workerId: string;
    readonly reason: string;
    readonly errorName?: string;
  }): Promise<boolean> => {
    if (this.claimedBy !== input.workerId) return false;
    this.claimedBy = null;
    this.deadLetter = {
      reason: input.reason,
      ...(input.errorName === undefined ? {} : { errorName: input.errorName }),
    };
    return true;
  };

  private claimedBy: string | null = null;
}

interface Harness {
  readonly worker: ChatDeliveryWorker;
  readonly queue: FakeDispatchQueue;
  readonly clock: { now: number };
  readonly failures: ChatDeliveryWorkerFailure[];
  readonly deadLetters: ChatDeliveryWorkerDeadLetter[];
  readonly circuit: ChatDeliveryWorkerCircuitState[];
}

function harness(
  reconcile: (dispatch: ChatDispatch) => Promise<void>,
  policyOptions: ConstructorParameters<typeof ChatDeliveryRetryPolicy>[0] = {},
): Harness {
  const clock = { now: 1_000 };
  const queue = new FakeDispatchQueue(clock);
  const failures: ChatDeliveryWorkerFailure[] = [];
  const deadLetters: ChatDeliveryWorkerDeadLetter[] = [];
  const circuit: ChatDeliveryWorkerCircuitState[] = [];
  const worker = new ChatDeliveryWorker(
    queue,
    { reconcile: (dispatch) => reconcile(dispatch) },
    {
      workerId,
      leaseMs: 60_000,
      now: () => clock.now,
      retryPolicy: new ChatDeliveryRetryPolicy({
        random: () => 0.5,
        ...policyOptions,
      }),
      onError: (failure) => failures.push(failure),
      onDeadLetter: (event) => deadLetters.push(event),
      onCircuitState: (event) => circuit.push(event),
    },
  );
  return { worker, queue, clock, failures, deadLetters, circuit };
}

describe('ChatDeliveryWorker retry pacing', () => {
  it('delays each retry exponentially and still delivers a late provider success', async () => {
    let attempts = 0;
    const { worker, queue, clock, failures } = harness(
      async () => {
        attempts += 1;
        if (attempts <= 3) throw new Error('provider flaked');
      },
      { baseDelayMs: 500, maxDelayMs: 30_000 },
    );

    // Failure 1: the activation is no longer claimable in the same instant.
    expect(await worker.step()).toMatchObject({ kind: 'processed' });
    expect(await worker.step()).toEqual({ kind: 'idle' });

    // Each further attempt only becomes possible after a longer wait.
    for (const expectedDelayMs of [1_000, 2_000]) {
      clock.now = queue.availableAtMs;
      expect(await worker.step()).toMatchObject({ kind: 'processed' });
      expect(queue.availableAtMs - clock.now).toBe(expectedDelayMs);
    }

    expect(queue.releases.map((release) => release.retryDelayMs)).toEqual([
      500, 1_000, 2_000,
    ]);
    expect(failures).toHaveLength(3);
    expect(failures[0]).toMatchObject({
      phase: 'deliver',
      dispatchId: 'dispatch-1',
      attemptCount: 1,
      outcome: 'retry',
      retryDelayMs: 500,
    });

    // The fourth attempt succeeds and publishes normally.
    clock.now = queue.availableAtMs;
    expect(await worker.step()).toMatchObject({ kind: 'processed' });
    expect(queue.publishedAt).not.toBeNull();
    expect(queue.deadLetter).toBeNull();
    expect(attempts).toBe(4);
  });

  it('parks a permanently failing activation instead of retrying it forever', async () => {
    const { worker, queue, clock, failures, deadLetters } = harness(
      async () => {
        throw new Error('provider is broken');
      },
      { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 30_000 },
    );

    for (let step = 0; step < 20; step += 1) {
      clock.now = Math.max(clock.now, queue.availableAtMs);
      await worker.step();
    }

    expect(queue.attemptCount).toBe(5);
    expect(queue.deadLetter).toEqual({
      reason: 'attempt_limit_exhausted',
      errorName: 'Error',
    });
    expect(queue.publishedAt).toBeNull();
    expect(failures).toHaveLength(5);
    expect(failures.at(-1)).toMatchObject({
      outcome: 'dead_letter',
      attemptCount: 5,
    });
    expect(deadLetters).toEqual([
      {
        dispatchId: 'dispatch-1',
        tenantId: 'tenant-a',
        conversationId: 'conversation-a',
        attemptCount: 5,
        reason: 'attempt_limit_exhausted',
        errorName: 'Error',
        parked: true,
      },
    ]);
    // A parked activation is no longer claimable, so the loop goes quiet.
    expect(await worker.step()).toEqual({ kind: 'idle' });
  });

  it('opens a cooldown circuit for an unavailable execution plane', async () => {
    const { worker, clock, circuit, deadLetters } = harness(
      async () => {
        throw new ExecutionPlaneUnavailableError();
      },
      { planeUnavailableMaxAttempts: 3, planeCooldownMs: 10_000 },
    );

    await worker.step();
    expect(circuit).toEqual([
      {
        state: 'open',
        cooldownMs: 10_000,
        errorName: 'ExecutionPlaneUnavailableError',
      },
    ]);

    // While the breaker is open the worker never claims another activation.
    clock.now += 1_000;
    expect(await worker.step()).toEqual({ kind: 'idle' });
    expect(circuit).toHaveLength(1);

    clock.now += 10_000;
    await worker.step();
    expect(circuit.map((event) => event.state)).toEqual([
      'open',
      'closed',
      'open',
    ]);

    // The plane-unavailable ceiling is lower than the ordinary one.
    clock.now += 10_000;
    await worker.step();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toMatchObject({
      attemptCount: 3,
      reason: 'execution_plane_unavailable',
    });
  });

  it('keeps deferring an activation whose chat runtime is not provisioned', async () => {
    const deferral = new Error('chat_turn_runtime_unavailable');
    deferral.name = 'ChatTurnRuntimeUnavailableError';
    const { worker, queue, clock } = harness(
      async () => {
        throw deferral;
      },
      { maxAttempts: 3, maxDelayMs: 5_000 },
    );

    for (let step = 0; step < 10; step += 1) {
      clock.now = Math.max(clock.now, queue.availableAtMs);
      await worker.step();
    }

    expect(queue.attemptCount).toBe(10);
    expect(queue.deadLetter).toBeNull();
    expect(queue.releases.at(-1)?.retryDelayMs).toBe(5_000);
  });

  it('backs off even when the repository has no parking seam', async () => {
    const clock = { now: 0 };
    const queue = new FakeDispatchQueue(clock);
    const worker = new ChatDeliveryWorker(
      {
        claimNext: queue.claimNext,
        completeClaim: queue.completeClaim,
        releaseClaim: queue.releaseClaim,
      },
      {
        reconcile: async () => {
          throw new Error('provider is broken');
        },
      },
      {
        workerId,
        leaseMs: 60_000,
        now: () => clock.now,
        retryPolicy: new ChatDeliveryRetryPolicy({
          random: () => 0.5,
          maxAttempts: 2,
          maxDelayMs: 30_000,
        }),
      },
    );

    await worker.step();
    clock.now = queue.availableAtMs;
    await worker.step();

    expect(queue.releases.map((release) => release.retryDelayMs)).toEqual([
      500, 30_000,
    ]);
  });
});
