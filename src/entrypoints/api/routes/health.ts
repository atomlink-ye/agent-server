import type { Hono } from 'hono';

import type { ReadinessProbe } from '../../../application/health/readiness.js';
import type {
  LivenessResponse,
  ReadinessResponse,
} from '../../../contracts/health.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';

export function registerHealthRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: {
    readonly config: AppConfig;
    readonly readiness: ReadinessProbe;
    readonly version: string;
  },
): void {
  app.get('/health/live', (context) => {
    const response: LivenessResponse = {
      status: 'ok',
      service: dependencies.config.serviceName,
      version: dependencies.version,
    };
    return context.json(response, 200);
  });

  app.get('/health/ready', async (context) => {
    const results = await dependencies.readiness.check();
    const ready = results.every((result) => result.ready);
    const response: ReadinessResponse = {
      status: ready ? 'ready' : 'not_ready',
      service: dependencies.config.serviceName,
      checks: results.map((result) => ({
        name: result.name,
        status: result.ready ? 'ready' : 'not_ready',
        ...(result.detail ? { detail: result.detail } : {}),
      })),
    };
    return context.json(response, ready ? 200 : 503);
  });
}
