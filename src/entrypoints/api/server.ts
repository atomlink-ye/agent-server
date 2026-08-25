import { serve } from '@hono/node-server';

import { createApplication } from '../../bootstrap.js';
import { loadConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/observability/logger.js';
import { registerBrowserContextRoutes } from './routes/browser-context.js';
import { registerBrowserCoworkerRoutes } from './routes/browser-coworkers.js';
import { registerBrowserWebRoutes } from './routes/browser-web.js';
import { shutdownService } from './shutdown.js';

const config = loadConfig();
const logger = createLogger({
  service: config.serviceName,
  minimumLevel: config.logLevel,
});
const { app, close } = await createApplication(config, logger);

// The canonical frontend is a pure Vite client. Browser-facing BFF routes live
// on Agent Server so service-account credentials never enter browser code.
if (
  !process.env.AGENT_SERVER_SERVICE_TOKEN?.trim() &&
  config.nodeEnv !== 'production'
) {
  const localAccount = config.serviceAccounts?.find(
    (account) => !account.disabled,
  );
  if (localAccount) process.env.AGENT_SERVER_SERVICE_TOKEN = localAccount.token;
}
registerBrowserCoworkerRoutes(app, config);
registerBrowserContextRoutes(app, config);
registerBrowserWebRoutes(app, config, logger);

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
      timeout_windows: [
        {
          name: 'PASEO_CONNECT_TIMEOUT_MS',
          value_ms: config.paseo.connectTimeoutMs,
          source: config.paseo.connectTimeoutSource,
        },
        {
          name: 'PASEO_EXECUTION_TIMEOUT_MS',
          value_ms: config.paseo.executionTimeoutMs,
          source: config.paseo.executionTimeoutSource,
        },
        {
          name: 'PASEO_SESSION_RPC_TIMEOUT_MS',
          value_ms: config.paseo.sessionRpcTimeoutMs,
          source: config.paseo.sessionRpcTimeoutSource,
        },
      ],
    });
  },
);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  await shutdownService({
    signal,
    logger,
    server,
    closeService: close,
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => {
      process.exitCode = 0;
    });
  });
}
