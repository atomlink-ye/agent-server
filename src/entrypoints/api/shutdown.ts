import type { ServerType } from '@hono/node-server';

import type { Logger } from '../../shared/observability/logger.js';

export interface ShutdownServiceOptions {
  readonly signal: string;
  readonly logger: Logger;
  readonly server: Pick<ServerType, 'close'>;
  readonly closeService: () => Promise<void>;
}

export async function shutdownService(
  options: ShutdownServiceOptions,
): Promise<void> {
  options.logger.log('info', 'service.stopping', { signal: options.signal });
  await closeServer(options.server);
  await options.closeService();
}

export function closeServer(server: Pick<ServerType, 'close'>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
