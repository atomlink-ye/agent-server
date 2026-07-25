import { describe, expect, it, vi } from 'vitest';
import type { ChannelOutbox } from '../../domain/channels/channel-delivery.js';
import { LarkOutboxWorker } from './outbox-worker.js';

const outbox = { id: 'outbox-1' } as ChannelOutbox;

describe('LarkOutboxWorker', () => {
  it('claims and delivers one outbox, then stops polling', async () => {
    const claimOutbox = vi
      .fn()
      .mockResolvedValueOnce(outbox)
      .mockResolvedValue(null);
    const execute = vi.fn().mockResolvedValue(undefined);
    const worker = new LarkOutboxWorker(
      { claimOutbox },
      { execute },
      { workerId: 'worker', leaseMs: 1000, pollIntervalMs: 1 },
    );
    worker.start();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith(outbox));
    await worker.stop();
    const count = claimOutbox.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(claimOutbox).toHaveBeenCalledTimes(count);
  });

  it('reports safe delivery failure metadata', async () => {
    const onError = vi.fn();
    const worker = new LarkOutboxWorker(
      { claimOutbox: vi.fn().mockResolvedValue(outbox) },
      { execute: vi.fn().mockRejectedValue(new Error('secret')) },
      { workerId: 'worker', leaseMs: 1000, onError },
    );
    worker.start();
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith({
        phase: 'deliver',
        errorName: 'Error',
      }),
    );
    await worker.stop();
    expect(JSON.stringify(onError.mock.calls)).not.toContain('secret');
  });
});
