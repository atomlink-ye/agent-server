import type { Hono } from 'hono';

import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  fetchAuthenticated,
  jsonResponse,
  readJson,
  safeStatus,
} from './browser-bff-transport.js';

/** Browser-safe pass-through for bounded ContextFS product projections. */
export function registerBrowserContextRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
): void {
  app.get('/api/context/files', (c) =>
    forward(config, `/api/v1/context/files${querySuffix(c.req.url)}`, 'GET'),
  );
  app.get('/api/context/file', (c) =>
    forward(config, `/api/v1/context/file${querySuffix(c.req.url)}`, 'GET'),
  );

  for (const path of [
    'promotions/conversation-to-user',
    'admissions/conversation-to-work',
    'publications/work-result',
    'pins/agent',
  ] as const) {
    app.post(`/api/context/${path}`, async (c) =>
      forward(config, `/api/v1/context/${path}`, 'POST', await c.req.text()),
    );
  }
}

async function forward(
  config: AppConfig,
  path: string,
  method: 'GET' | 'POST',
  body?: string,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchAuthenticated(config, path, {
      method,
      headers: {
        ...(method === 'POST'
          ? { 'content-type': 'application/json; charset=utf-8' }
          : {}),
      },
      ...(body !== undefined ? { body } : {}),
    });
  } catch {
    return jsonResponse(
      {
        error: {
          code: 'service_unavailable',
          message: 'Context could not be loaded or changed.',
        },
      },
      503,
    );
  }

  const parsed = await readJson(upstream, { emptyValue: {} });
  const payload =
    parsed === undefined
      ? {
          error: {
            code: 'invalid_response',
            message: 'The service returned an invalid Context response.',
          },
        }
      : parsed;
  return jsonResponse(payload, safeStatus(upstream.status, 200), {
    'x-agent-server-upstream': 'fetched',
  });
}

function querySuffix(url: string): string {
  const query = new URL(url).search;
  return query || '';
}
