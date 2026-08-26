import type { Hono } from 'hono';

import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  fetchAuthenticated,
  isUpstreamOversizeResponse,
  jsonResponse,
  readJson,
  safeStatus,
} from './browser-bff-transport.js';
import {
  ContextAgentPinRequestSchema,
  ContextConversationToUserPromotionRequestSchema,
  ContextConversationToWorkAdmissionRequestSchema,
  ContextWorkResultPublicationRequestSchema,
} from '../../../contracts/context.js';

/**
 * The browser facade states the same ContextFS request contract the
 * `/api/v1/context` entrypoint enforces, instead of relaying an unvalidated
 * body and letting the browser discover the shape from an upstream rejection.
 * Both sides now read one module, so they cannot drift.
 */
const CONTEXT_MUTATION_CONTRACTS = {
  'promotions/conversation-to-user':
    ContextConversationToUserPromotionRequestSchema,
  'admissions/conversation-to-work':
    ContextConversationToWorkAdmissionRequestSchema,
  'publications/work-result': ContextWorkResultPublicationRequestSchema,
  'pins/agent': ContextAgentPinRequestSchema,
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

  for (const [path, schema] of Object.entries(CONTEXT_MUTATION_CONTRACTS)) {
    app.post(`/api/context/${path}`, async (c) => {
      const body = await c.req.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return invalidContextRequest();
      }
      if (!schema.safeParse(parsed).success) return invalidContextRequest();
      return forward(config, `/api/v1/context/${path}`, 'POST', body);
    });
  }
}

function invalidContextRequest(): Response {
  return jsonResponse(
    {
      error: {
        code: 'invalid_request',
        message: 'The context request is invalid.',
      },
    },
    400,
  );
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
  // An oversize body is not decoded, so it must not fall through to `parsed`
  // below (that would forward the internal marker object as if it were the
  // Context payload). Context responses stay small in practice, so this
  // path is defensive: it keeps this route correct rather than papering over
  // it, without adopting the richer too-large reporting the Work Run
  // session-transcripts route now has.
  const payload =
    parsed === undefined || isUpstreamOversizeResponse(parsed)
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
