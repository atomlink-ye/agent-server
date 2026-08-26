import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { type ZodType } from 'zod';

import {
  AgentCoworkerListResponseSchema,
  AgentCoworkerProfileResponseSchema,
  AgentIdSchema,
  AssociateAgentCapabilityRequestSchema,
  AssociateAgentCapabilityResponseSchema,
  CreateCoworkerRequestSchema,
  CreateCoworkerResponseSchema,
} from '../../../contracts/agents.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { decodeProductResponse } from '../browser-product-decoder.js';
import {
  fetchAuthenticated,
  jsonResponse,
  readJson,
  safeStatus,
} from './browser-bff-transport.js';

/** Browser-safe canonical Agent roster/profile/authoring facade for Vite. */
export function registerBrowserCoworkerRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
): void {
  app.get('/api/agents', async () => {
    return forwardValidated(
      config,
      '/api/v1/agents?limit=100',
      { method: 'GET' },
      AgentCoworkerListResponseSchema,
      'Coworkers could not be loaded.',
      'The service returned an invalid Coworker roster.',
    );
  });

  app.post('/api/agents', async (c) => {
    const parsed = CreateCoworkerRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return invalidRequest('The Coworker draft is invalid.');
    return forwardValidated(
      config,
      '/api/v1/coworkers',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(parsed.data),
      },
      CreateCoworkerResponseSchema,
      'The Coworker could not be created.',
      'The service returned an invalid Coworker creation result.',
      201,
    );
  });

  app.get('/api/agents/:agentId/profile', async (c) => {
    const agentId = c.req.param('agentId');
    if (!AgentIdSchema.safeParse(agentId).success)
      return invalidRequest('The Agent id is invalid.');
    return forwardValidated(
      config,
      `/api/v1/agents/${agentId}/profile`,
      { method: 'GET' },
      AgentCoworkerProfileResponseSchema,
      'The Coworker profile could not be loaded.',
      'The service returned an invalid Coworker profile.',
    );
  });

  app.post('/api/agents/:agentId/capabilities', async (c) => {
    // Capability binding is Product-Work-shaped (a Capability is a
    // published Work Definition), so it asserts availability explicitly
    // here rather than through a `/api/agents` prefix guard -- that prefix
    // would wrongly take out the Coworker roster and profile routes above,
    // which stay reachable regardless of Product Work availability.
    if (config.productWorkSurface !== 'composed')
      return jsonResponse(
        {
          error: {
            code: 'feature_unavailable',
            message: 'Work management is not available in this environment.',
          },
        },
        503,
      );
    const agentId = c.req.param('agentId');
    if (!AgentIdSchema.safeParse(agentId).success)
      return invalidRequest('The Agent id is invalid.');
    const parsed = AssociateAgentCapabilityRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return invalidRequest('The Capability binding is invalid.');
    return forwardValidated(
      config,
      `/api/v1/agents/${agentId}/capabilities`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      },
      AssociateAgentCapabilityResponseSchema,
      'The Capability could not be added to this Coworker.',
      'The service returned an invalid Capability binding result.',
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
