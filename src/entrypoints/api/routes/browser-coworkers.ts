import type { Hono } from 'hono';

import { AgentCoworkerListResponseSchema } from '../../../contracts/agents.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { decodeProductResponse } from '../browser-product-decoder.js';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

/**
 * Browser-safe Coworker roster facade for the Vite client.
 *
 * The browser never receives the service-account credential. This route
 * forwards the bounded AgentDefinition roster read to the authenticated
 * control-plane API and validates the response against the public contract.
 */
export function registerBrowserCoworkerRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
): void {
  app.get('/api/agents', async () => {
    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl(config, '/api/v1/agents?limit=100'), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${browserServiceToken(config)}`,
        },
      });
    } catch {
      return jsonResponse(
        {
          error: {
            code: 'service_unavailable',
            message: 'Coworkers could not be loaded.',
          },
        },
        503,
      );
    }

    const body = await upstream.json().catch(() => undefined);
    if (!upstream.ok) {
      const error = normalizeError(body);
      return jsonResponse(error, safeStatus(upstream.status));
    }

    const decoded = decodeProductResponse(body, AgentCoworkerListResponseSchema);
    if (!decoded.success) {
      return jsonResponse(
        {
          error: {
            code: 'invalid_response',
            message: 'The service returned an invalid Coworker roster.',
          },
        },
        502,
      );
    }
    return jsonResponse(decoded.data, upstream.status, {
      'x-agent-server-upstream': 'fetched',
    });
  });
}

function upstreamUrl(config: AppConfig, path: string): string {
  const configured = process.env.AGENT_SERVER_BASE_URL?.trim();
  const base = configured || `http://127.0.0.1:${config.port}`;
  return `${base.replace(/\/$/u, '')}${path}`;
}

function browserServiceToken(config: AppConfig): string {
  const configured = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
  if (configured) return configured;
  const active = (config.serviceAccounts ?? []).filter((account) => !account.disabled);
  if (active.length === 1) return active[0]!.token;
  throw new Error('browser_web_service_token_missing');
}

function normalizeError(body: unknown): {
  readonly error: { readonly code: string; readonly message: string };
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: {
        code: 'request_failed',
        message: 'Coworkers could not be loaded.',
      },
    };
  }
  const candidate = (body as Record<string, unknown>).error;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      error: {
        code: 'request_failed',
        message: 'Coworkers could not be loaded.',
      },
    };
  }
  const record = candidate as Record<string, unknown>;
  return {
    error: {
      code:
        typeof record.code === 'string' && record.code.length > 0
          ? record.code
          : 'request_failed',
      message:
        typeof record.message === 'string' && record.message.length > 0
          ? record.message
          : 'Coworkers could not be loaded.',
    },
  };
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
  return status >= 400 && status < 600 ? status : 502;
}
