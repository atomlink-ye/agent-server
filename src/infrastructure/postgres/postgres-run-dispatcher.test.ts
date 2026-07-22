import { describe, expect, it, vi } from 'vitest';

import { PostgresRunDispatcher } from './postgres-run-dispatcher.js';

describe('PostgresRunDispatcher', () => {
  it('does not claim queued work until the runtime is ready', async () => {
    const claimNextRun = {
      execute: vi.fn(async () => {
        throw new Error(
          'claim should not run while the runtime is unavailable',
        );
      }),
    };
    const executeRun = {
      ensureRuntimeReady: vi.fn(async () => false),
      execute: vi.fn(),
    };
    const dispatcher = new PostgresRunDispatcher(
      claimNextRun as never,
      executeRun as never,
      { log: () => undefined },
      { pollIntervalMs: 1 },
    );

    dispatcher.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await dispatcher.stop();

    expect(executeRun.ensureRuntimeReady).toHaveBeenCalled();
    expect(claimNextRun.execute).not.toHaveBeenCalled();
    expect(executeRun.execute).not.toHaveBeenCalled();
  });
});
