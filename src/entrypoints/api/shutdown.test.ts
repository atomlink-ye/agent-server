import { describe, expect, it, vi } from 'vitest';

import { shutdownService } from './shutdown.js';

describe('shutdownService', () => {
  it('stops accepting new requests before closing service resources', async () => {
    const events: string[] = [];
    const serverClosed = createDeferred();

    const shuttingDown = shutdownService({
      signal: 'SIGTERM',
      logger: {
        log: vi.fn((_level, event) => {
          events.push(event);
        }),
      },
      server: {
        close(callback?: (error?: Error | undefined) => void) {
          events.push('server.close:start');
          serverClosed.resolve = () => {
            events.push('server.close:done');
            callback?.();
          };
          return this as never;
        },
      },
      closeService: vi.fn(async () => {
        events.push('service.close');
      }),
    });

    await Promise.resolve();

    expect(events).toEqual(['service.stopping', 'server.close:start']);

    serverClosed.resolve();
    await shuttingDown;

    expect(events).toEqual([
      'service.stopping',
      'server.close:start',
      'server.close:done',
      'service.close',
    ]);
  });
});

function createDeferred(): { resolve: () => void } {
  return { resolve: () => undefined };
}
