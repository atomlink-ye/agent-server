import type { Hono } from 'hono';

import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

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
    upstream = await fetch(upstreamUrl(config, path), {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${browserServiceToken(config)}`,
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

  const text = await upstream.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {
      error: {
        code: 'invalid_response',
        message: 'The service returned an invalid Context response.',
      },
    };
  }
  return jsonResponse(payload, safeStatus(upstream.status), {
    'x-agent-server-upstream': 'fetched',
  });
}

function querySuffix(url: string): string {
  const query = new URL(url).search;
  return query || '';
}
function upstreamUrl(config: AppConfig, path: string): string {
  const configured = process.env.AGENT_SERVER_BASE_URL?.trim();
  const base = configured || `http://127.0.0.1:${config.port}`;
  return `${base.replace(/\/$/u, '')}${path}`;
}
function browserServiceToken(config: AppConfig): string {
  const configured = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
  if (configured) return configured;
  const active = (config.serviceAccounts ?? []).filter(
    (account) => !account.disabled,
  );
  if (active.length === 1) return active[0]!.token;
  throw new Error('browser_web_service_token_missing');
}
function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}
function safeStatus(status: number): number {
  return status >= 200 && status < 600 ? status : 502;
}
