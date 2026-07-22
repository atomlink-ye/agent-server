import { serve, type ServerType } from '@hono/node-server';

import { createService } from '../../bootstrap.js';
import { loadConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/observability/logger.js';

const config = loadConfig();
const logger = createLogger({
  service: config.serviceName,
  minimumLevel: config.logLevel,
});
const { app, runtime } = createService(config, logger);

void runtime.initialize().catch((error: unknown) => {
  logger.log('warn', 'runtime.initialization_failed', {
    error_name: error instanceof Error ? error.name : 'UnknownError',
  });
});

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (address) => {
    logger.log('info', 'service.started', {
      host: address.address,
      port: address.port,
      environment: config.nodeEnv,
    });
  },
);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.log('info', 'service.stopping', { signal });
  await Promise.allSettled([closeServer(server), runtime.close()]);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => {
      process.exitCode = 0;
    });
  });
}

function closeServer(serverToClose: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    serverToClose.close((error) => (error ? reject(error) : resolve()));
  });
}
