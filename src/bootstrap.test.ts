import { describe, expect, it, vi } from 'vitest';

import { closeServiceResources } from './bootstrap.js';

describe('closeServiceResources', () => {
  it('waits for dispatcher shutdown before closing the runtime and database', async () => {
    const events: string[] = [];
    const dispatcherStopped = createDeferred();

    const closing = closeServiceResources({
      dispatcher: {
        stop: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              events.push('dispatcher.stop:start');
              dispatcherStopped.resolve = () => {
                events.push('dispatcher.stop:done');
                resolve();
              };
            }),
        ),
      },
      runtime: {
        close: vi.fn(async () => {
          events.push('runtime.close');
        }),
      },
      pool: {
        end: vi.fn(async () => {
          events.push('pool.end');
        }),
      },
    });

    await Promise.resolve();

    expect(events).toEqual(['dispatcher.stop:start']);

    dispatcherStopped.resolve();
    await closing;

    expect(events).toEqual([
      'dispatcher.stop:start',
      'dispatcher.stop:done',
      'runtime.close',
      'pool.end',
    ]);
  });
});

function createDeferred(): { resolve: () => void } {
  return { resolve: () => undefined };
}
