import { serve } from '@hono/node-server';

import { createApplication } from '../../bootstrap.js';
import { loadConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/observability/logger.js';
import { createBrowserFeatureAvailabilityGuard } from './routes/browser-feature-availability.js';
import { registerBrowserContextRoutes } from './routes/browser-context.js';
import { registerBrowserCoworkerRoutes } from './routes/browser-coworkers.js';
import { registerBrowserWebRoutes } from './routes/browser-web.js';
import { registerBrowserWorkOrganizationRoutes } from './routes/browser-work-organization.js';
import { shutdownService } from './shutdown.js';

// Work, Work Organization, Work Definition authoring, and the Skill catalog
// Work authoring selects from are only reachable when the Product Work
// surface is composed (see src/entrypoints/api/app.ts, the single owner of
// that gate). When it is absent, guard their browser BFF surfaces from
// configuration rather than letting the browser see a bare control-plane
// route_not_found -- the BFF cannot tell an uninstalled route apart from a
// typo that way.
//
// /api/agents is deliberately NOT included here: the Coworker roster and
// profile stay reachable regardless of Product Work availability, so the
// Capability-binding route (POST /api/agents/:agentId/capabilities) asserts
// availability explicitly inside its own handler instead.
const PRODUCT_WORK_BROWSER_ROUTE_PREFIXES = [
  '/api/works',
  '/api/work-items',
  '/api/boards',
  '/api/work-definitions',
  '/api/skills',
] as const;

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
if (config.productWorkSurface !== 'composed') {
  app.use(
    '*',
    createBrowserFeatureAvailabilityGuard(
      PRODUCT_WORK_BROWSER_ROUTE_PREFIXES,
      'Work management is not available in this environment.',
    ),
  );
}
registerBrowserCoworkerRoutes(app, config);
registerBrowserContextRoutes(app, config);
registerBrowserWebRoutes(app, config, logger);
registerBrowserWorkOrganizationRoutes(app, config);

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
