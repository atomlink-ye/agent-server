import { describe, expect, it, vi } from 'vitest';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import { LarkIngressWorker } from './worker.js';

const ingress = { id: 'ingress-1' } as ChannelIngress;

describe('LarkIngressWorker', () => {
  it('claims, processes, polls, and stops without another claim after shutdown', async () => {
    const claimIngress = vi
      .fn<() => Promise<ChannelIngress | null>>()
      .mockResolvedValueOnce(ingress)
      .mockResolvedValue(null);
    const process = vi.fn(async () => ({
      accepted: false as const,
      reason: 'chat_not_allowed',
    }));
    const worker = new LarkIngressWorker(
      { claimIngress, completeIngress: vi.fn() },
      { execute: process },
      { workerId: 'worker-1', leaseMs: 1000, pollIntervalMs: 1 },
    );

    worker.start();
    await vi.waitFor(() => expect(process).toHaveBeenCalledOnce());
    await worker.stop();
    const claims = claimIngress.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(claimIngress).toHaveBeenCalledTimes(claims);
  });

  it('stops deterministically and reports a claim failure without rejecting the loop', async () => {
    const onError = vi.fn();
    const claimIngress = vi
      .fn<() => Promise<ChannelIngress | null>>()
      .mockRejectedValue(new Error('database secret'));
    const worker = new LarkIngressWorker(
      { claimIngress, completeIngress: vi.fn() },
      { execute: vi.fn() },
      { workerId: 'worker-claim-error', leaseMs: 1000, onError },
    );

    worker.start();
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith({
        phase: 'claim',
        errorName: 'Error',
      }),
    );
    await expect(worker.stop()).resolves.toBeUndefined();
    expect(claimIngress).toHaveBeenCalledOnce();
  });

  it('stops deterministically when completion fails and never logs the raw error', async () => {
    const onError = vi.fn();
    const completeIngress = vi
      .fn()
      .mockRejectedValue(new Error('provider secret'));
    const worker = new LarkIngressWorker(
      {
        claimIngress: vi.fn().mockResolvedValue(ingress),
        completeIngress,
      },
      { execute: vi.fn().mockRejectedValue(new Error('processor failure')) },
      { workerId: 'worker-complete-error', leaseMs: 1000, onError },
    );

    worker.start();
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith({
        phase: 'complete',
        errorName: 'Error',
      }),
    );
    await worker.stop();
    expect(onError.mock.calls.flat()).not.toContain('provider secret');
  });
});
