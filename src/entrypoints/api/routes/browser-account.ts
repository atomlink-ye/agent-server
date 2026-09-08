import type { Hono } from 'hono';
import { type ZodType } from 'zod';

import {
  AccountResponseSchema,
  SetDisplayNameRequestSchema,
  SetDisplayNameResponseSchema,
} from '../../../contracts/account.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { getBrowserUserId, USER_ID_HEADER } from '../access-context.js';
import { decodeProductResponse } from '../browser-product-decoder.js';
import {
  fetchAuthenticated,
  jsonResponse,
  readJson,
  safeStatus,
} from './browser-bff-transport.js';

/**
 * Browser-safe facade for the caller's own identity. Not Product-Work-shaped
 * (see the comment above `registerAccountRoutes` in
 * `src/entrypoints/api/routes/account.ts`), so this stays reachable
 * regardless of Product Work composition and must never be added to
 * `PRODUCT_WORK_BROWSER_ROUTE_PREFIXES`.
 */
export function registerBrowserAccountRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
): void {
  app.get('/api/account', async (c) => {
    // Forward the identity established by the server-side session middleware.
    const userId = getBrowserUserId(c);
    return forwardValidated(
      config,
      '/api/v1/account',
      {
        method: 'GET',
        headers: userId ? { [USER_ID_HEADER]: userId } : {},
      },
      AccountResponseSchema,
      'Your account could not be loaded.',
      'The service returned an invalid account response.',
    );
  });

  app.patch('/api/account/display-name', async (c) => {
    const parsed = SetDisplayNameRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest('The display name is invalid.');
    // A person may only ever rename themselves; the request body has no
    // principal id for it to accept or relay on someone else's behalf.
    const userId = getBrowserUserId(c);
    return forwardValidated(
      config,
      '/api/v1/account/display-name',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(userId ? { [USER_ID_HEADER]: userId } : {}),
        },
        body: JSON.stringify(parsed.data),
      },
      SetDisplayNameResponseSchema,
      'Your display name could not be updated.',
      'The service returned an invalid display name response.',
    );
  });
}

async function forwardValidated(
  config: AppConfig,
  path: string,
  init: RequestInit,
  schema: ZodType<unknown>,
  requestFailure: string,
  invalidResponse: string,
  successStatus?: number,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchAuthenticated(config, path, init);
  } catch {
    return jsonResponse(
      { error: { code: 'service_unavailable', message: requestFailure } },
      503,
    );
  }

  const body = await readJson(upstream);
  if (!upstream.ok)
    return jsonResponse(
      normalizeError(body, requestFailure),
      safeStatus(upstream.status),
    );
  const decoded = decodeProductResponse(body, schema);
  if (!decoded.success) {
    return jsonResponse(
      { error: { code: 'invalid_response', message: invalidResponse } },
      502,
    );
  }
  return jsonResponse(decoded.data, successStatus ?? upstream.status, {
    'x-agent-server-upstream': 'fetched',
  });
}

function invalidRequest(message: string): Response {
  return jsonResponse({ error: { code: 'invalid_request', message } }, 400);
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
