import type { Hono } from 'hono';
import { type ZodType } from 'zod';

import {
  AgentCoworkerListResponseSchema,
  AgentCoworkerProfileResponseSchema,
  AgentIdSchema,
} from '../../../contracts/agents.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { decodeProductResponse } from '../browser-product-decoder.js';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

/** Browser-safe canonical Agent roster/profile facade for the Vite client. */
export function registerBrowserCoworkerRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
): void {
  app.get('/api/agents', async () => {
    return forwardValidated(
      config,
      '/api/v1/agents?limit=100',
      AgentCoworkerListResponseSchema,
      'Coworkers could not be loaded.',
      'The service returned an invalid Coworker roster.',
    );
  });

  app.get('/api/agents/:agentId/profile', async (c) => {
    const agentId = c.req.param('agentId');
    if (!AgentIdSchema.safeParse(agentId).success) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'The Agent id is invalid.' } },
        400,
      );
    }
    return forwardValidated(
      config,
      `/api/v1/agents/${agentId}/profile`,
      AgentCoworkerProfileResponseSchema,
      'The Coworker profile could not be loaded.',
      'The service returned an invalid Coworker profile.',
    );
  });
}

async function forwardValidated(
  config: AppConfig,
  path: string,
  schema: ZodType<unknown>,
  requestFailure: string,
  invalidResponse: string,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(config, path), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${browserServiceToken(config)}`,
      },
    });
  } catch {
    return jsonResponse(
      { error: { code: 'service_unavailable', message: requestFailure } },
      503,
    );
  }

  const body = await upstream.json().catch(() => undefined);
  if (!upstream.ok) return jsonResponse(normalizeError(body, requestFailure), safeStatus(upstream.status));
  const decoded = decodeProductResponse(body, schema);
  if (!decoded.success) {
    return jsonResponse(
      { error: { code: 'invalid_response', message: invalidResponse } },
      502,
    );
  }
  return jsonResponse(decoded.data, upstream.status, {
    'x-agent-server-upstream': 'fetched',
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

function normalizeError(
  body: unknown,
  fallback: string,
): { readonly error: { readonly code: string; readonly message: string } } {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { error: { code: 'request_failed', message: fallback } };
  const candidate = (body as Record<string, unknown>).error;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    return { error: { code: 'request_failed', message: fallback } };
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
          : fallback,
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
