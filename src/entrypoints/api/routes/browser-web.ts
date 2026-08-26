import type { Hono } from 'hono';
import { z, type ZodType } from 'zod';

import {
  CreateWorkRequestSchema,
  CreateWorkResponseSchema,
  ErrorResponseSchema,
  GetProductWorkDefinitionVersionResponseSchema,
  ListProductWorkDefinitionsResponseSchema,
  GetWorkResponseSchema,
  ProductExecutionDetailResponseSchema,
  ProductRunTraceResponseSchema,
  ProductSessionTranscriptsResponseSchema,
  ProductWorkRunResponseSchema,
  StartWorkRunRequestSchema,
  StartWorkRunResponseSchema,
  UpdateWorkDefinitionVersionRequestSchema,
  UpdateWorkDefinitionVersionResponseSchema,
  WorkDefinitionApplyResponseSchema,
  WorkDefinitionPlanResponseSchema,
  WorkDefinitionResponseSchema,
  WorkDefinitionSourceRequestSchema,
  WorkDefinitionValidateFailureSchema,
  WorkDefinitionValidateSuccessSchema,
  WorkListResponseSchema,
  WorkRunListResponseSchema,
} from '../../../contracts/product-accepted-subset/index.js';
import {
  ChatWorkCardSchema,
  ConversationListResponseSchema,
  ConversationMessagesResponseSchema,
  ConversationPostResponseSchema,
  ConversationReadResponseSchema,
  CreateConversationRequestSchema,
  PostConversationMessageRequestSchema,
} from '../../../contracts/conversations.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import type { Logger } from '../../../shared/observability/logger.js';
import { decodeProductResponse } from '../browser-product-decoder.js';
import {
  fetchAuthenticated,
  isUpstreamOversizeResponse,
  jsonResponse,
  readJson,
  safeStatus,
} from './browser-bff-transport.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workDefinitionAuthoringErrorSchema = z.union([
  WorkDefinitionValidateFailureSchema,
  ErrorResponseSchema,
]);
const startRunErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    request_id: z.string().min(1),
    path: z.string().optional(),
  }),
});
const browserWorkDefinitionSelectorResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            definitionId: z.string().uuid(),
            displayName: z.string().min(1),
            currentPublishedVersionId: z.string().uuid(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

/**
 * Browser-safe facade for the single Vite frontend.
 *
 * The browser never receives a service-account token. These routes forward a
 * deliberately small Product/Conversation surface to the existing authenticated
 * /api/v1 contract, then decode the response back through the accepted schemas.
 * This replaces the old Next.js app/api BFF without creating a second frontend
 * runtime.
 */
export function registerBrowserWebRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
  logger: Logger,
): void {
  app.get('/api/conversations', async () =>
    readBrowserJson(
      config,
      logger,
      '/api/v1/conversations',
      ConversationListResponseSchema,
    ),
  );
  app.post('/api/conversations', async (c) => {
    const parsed = CreateConversationRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return writeBrowserJson(
      config,
      logger,
      '/api/v1/conversations',
      parsed.data,
      ConversationReadResponseSchema,
      { successStatus: 201 },
    );
  });
  app.get('/api/conversations/:conversationId', async (c) => {
    const id = c.req.param('conversationId');
    if (!isId(id)) return invalidRequest();
    return readBrowserJson(
      config,
      logger,
      `/api/v1/conversations/${encodeURIComponent(id)}`,
      ConversationReadResponseSchema,
    );
  });
  app.get('/api/conversations/:conversationId/messages', async (c) => {
    const id = c.req.param('conversationId');
    if (!isId(id)) return invalidRequest();
    return readBrowserJson(
      config,
      logger,
      `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
      ConversationMessagesResponseSchema,
    );
  });
  app.post('/api/conversations/:conversationId/messages', async (c) => {
    const id = c.req.param('conversationId');
    if (!isId(id)) return invalidRequest();
    const parsed = PostConversationMessageRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return writeBrowserJson(
      config,
      logger,
      `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
      parsed.data,
      ConversationPostResponseSchema,
      { successStatus: 202 },
    );
  });

  app.get('/api/works', async () =>
    readProductJson(
      config,
      logger,
      '/api/v1/works?limit=100&order=updated_desc',
      WorkListResponseSchema,
    ),
  );
  app.post('/api/works', async (c) => {
    const parsed = CreateWorkRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidProductRequest();
    return writeProductJson(
      config,
      logger,
      '/api/v1/works',
      parsed.data,
      CreateWorkResponseSchema,
    );
  });
  app.get('/api/works/:workId', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidProductRequest();
    return readProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}`,
      GetWorkResponseSchema,
    );
  });
  app.get('/api/works/:workId/chat-card', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidRequest();
    return readBrowserJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/chat-card`,
      ChatWorkCardSchema,
      { notFoundCode: 'work_not_found' },
    );
  });
  app.get('/api/works/:workId/definition', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidProductRequest();
    return readProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/definition`,
      WorkDefinitionResponseSchema,
    );
  });
  app.post('/api/works/:workId/definition-version', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidProductRequest();
    const parsed = UpdateWorkDefinitionVersionRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidProductRequest();
    return writeProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/definition-version`,
      parsed.data,
      UpdateWorkDefinitionVersionResponseSchema,
    );
  });
  app.get('/api/works/:workId/runs', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidProductRequest();
    return readProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/runs?limit=100&order=created_desc`,
      WorkRunListResponseSchema,
    );
  });
  app.post('/api/works/:workId/runs', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidProductRequest();
    const parsed = StartWorkRunRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidProductRequest();
    return writeProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/runs`,
      parsed.data,
      StartWorkRunResponseSchema,
      { errorSchema: startRunErrorSchema },
    );
  });
  app.get('/api/works/:workId/runs/:workRunId', async (c) => {
    const { workId, workRunId } = workParams(c.req.param());
    if (!workId || !workRunId) return invalidProductRequest();
    return readProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}`,
      ProductWorkRunResponseSchema,
    );
  });
  app.get('/api/works/:workId/runs/:workRunId/trace', async (c) => {
    const { workId, workRunId } = workParams(c.req.param());
    if (!workId || !workRunId) return invalidProductRequest();
    return readProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}/trace`,
      ProductRunTraceResponseSchema,
    );
  });
  app.get('/api/works/:workId/runs/:workRunId/execution-detail', async (c) => {
    const { workId, workRunId } = workParams(c.req.param());
    const attemptId = c.req.query('attempt_id');
    if (!workId || !workRunId || !attemptId || !isUuid(attemptId))
      return invalidProductRequest();
    return readProductJson(
      config,
      logger,
      `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}/execution-detail?attempt_id=${encodeURIComponent(attemptId)}`,
      ProductExecutionDetailResponseSchema,
    );
  });
  app.get(
    '/api/works/:workId/runs/:workRunId/session-transcripts',
    async (c) => {
      const { workId, workRunId } = workParams(c.req.param());
      if (!workId || !workRunId) return invalidProductRequest();
      return readProductJson(
        config,
        logger,
        `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}/session-transcripts`,
        ProductSessionTranscriptsResponseSchema,
      );
    },
  );

  app.get('/api/work-definition-versions/:versionId', async (c) => {
    const versionId = c.req.param('versionId');
    if (!isUuid(versionId)) return invalidProductRequest();
    return readProductJson(
      config,
      logger,
      `/api/v1/work-definition-versions/${encodeURIComponent(versionId)}`,
      GetProductWorkDefinitionVersionResponseSchema,
    );
  });
  app.get('/api/work-definitions', async () =>
    forwardDecoded(
      config,
      logger,
      '/api/v1/work-definitions?limit=100',
      { method: 'GET' },
      ListProductWorkDefinitionsResponseSchema,
      ErrorResponseSchema,
      {
        transform: browserWorkDefinitionSelectors,
      },
    ),
  );
  app.post('/api/work-definitions/validate', async (c) =>
    writeWorkDefinition(
      config,
      logger,
      c,
      'validate',
      WorkDefinitionValidateSuccessSchema,
    ),
  );
  app.post('/api/work-definitions/plan', async (c) =>
    writeWorkDefinition(
      config,
      logger,
      c,
      'plan',
      WorkDefinitionPlanResponseSchema,
    ),
  );
  app.post('/api/work-definitions/apply', async (c) => {
    const idempotencyKey = c.req.header('idempotency-key')?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 256)
      return invalidProductRequest();
    return writeWorkDefinition(
      config,
      logger,
      c,
      'apply',
      WorkDefinitionApplyResponseSchema,
      idempotencyKey,
    );
  });
}

async function writeWorkDefinition(
  config: AppConfig,
  logger: Logger,
  c: any,
  action: 'validate' | 'plan' | 'apply',
  schema: ZodType<unknown>,
  idempotencyKey?: string,
): Promise<Response> {
  const parsed = WorkDefinitionSourceRequestSchema.safeParse(
    await c.req.json().catch(() => undefined),
  );
  if (!parsed.success) return invalidProductRequest();
  return writeProductJson(
    config,
    logger,
    `/api/v1/work-definitions:${action}`,
    parsed.data,
    schema,
    {
      errorSchema: workDefinitionAuthoringErrorSchema,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  );
}

async function readProductJson(
  config: AppConfig,
  logger: Logger,
  path: string,
  schema: ZodType<unknown>,
): Promise<Response> {
  return forwardDecoded(
    config,
    logger,
    path,
    { method: 'GET' },
    schema,
    ErrorResponseSchema,
  );
}

async function writeProductJson(
  config: AppConfig,
  logger: Logger,
  path: string,
  body: unknown,
  schema: ZodType<unknown>,
  options: {
    readonly idempotencyKey?: string;
    readonly errorSchema?: ZodType<unknown>;
  } = {},
): Promise<Response> {
  return forwardDecoded(
    config,
    logger,
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(options.idempotencyKey
          ? { 'idempotency-key': options.idempotencyKey }
          : {}),
      },
    },
    schema,
    options.errorSchema ?? ErrorResponseSchema,
  );
}

async function readBrowserJson(
  config: AppConfig,
  logger: Logger,
  path: string,
  schema: ZodType<unknown>,
  options: { readonly notFoundCode?: string } = {},
): Promise<Response> {
  return forwardDecoded(
    config,
    logger,
    path,
    { method: 'GET' },
    schema,
    ErrorResponseSchema,
    options,
  );
}

async function writeBrowserJson(
  config: AppConfig,
  logger: Logger,
  path: string,
  body: unknown,
  schema: ZodType<unknown>,
  options: { readonly successStatus?: number } = {},
): Promise<Response> {
  return forwardDecoded(
    config,
    logger,
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
    schema,
    ErrorResponseSchema,
    options,
  );
}

async function forwardDecoded(
  config: AppConfig,
  logger: Logger,
  path: string,
  init: RequestInit,
  successSchema: ZodType<unknown>,
  errorSchema: ZodType<unknown>,
  options: {
    readonly successStatus?: number;
    readonly notFoundCode?: string;
    readonly transform?: (value: unknown) => unknown;
  } = {},
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchAuthenticated(config, path, init);
  } catch {
    return unavailable();
  }
  const body = await readJson(upstream);
  if (isUpstreamOversizeResponse(body)) {
    // The upstream response was valid but exceeded the size this gateway can
    // safely buffer/forward -- a distinct, attributable failure from a body
    // that failed to decode. Logging the declared size (never the body) is
    // what lets an operator tell "the response was too big" apart from a
    // bare, unexplained 502.
    logger.log('warn', 'browser_bff.upstream_response_too_large', {
      path,
      declared_bytes: body.declaredBytes,
    });
    return upstreamTooLarge();
  }
  if (upstream.ok) {
    const decoded = decodeProductResponse(body, successSchema);
    if (!decoded.success) return invalidUpstream();
    return jsonResponse(
      options.transform ? options.transform(decoded.data) : decoded.data,
      options.successStatus ?? upstream.status,
      { 'x-agent-server-upstream': 'fetched' },
    );
  }
  const decoded = decodeProductResponse(body, errorSchema);
  if (!decoded.success) return invalidUpstream();
  if (upstream.status === 404 && options.notFoundCode) {
    return jsonResponse(
      {
        error: {
          code: options.notFoundCode,
          message: 'The requested resource was not found.',
        },
      },
      404,
    );
  }
  return jsonResponse(decoded.data, safeStatus(upstream.status));
}

function browserWorkDefinitionSelectors(value: unknown): unknown {
  const response = ListProductWorkDefinitionsResponseSchema.parse(value);
  return browserWorkDefinitionSelectorResponseSchema.parse({
    items: response.items.map((item) => ({
      definitionId: item.definition_id,
      displayName: item.display_name,
      currentPublishedVersionId: item.current_published_version_id,
    })),
  });
}

function workParams(params: Record<string, string>): {
  readonly workId: string | null;
  readonly workRunId: string | null;
} {
  return {
    workId: isUuid(params.workId) ? params.workId : null,
    workRunId: isUuid(params.workRunId) ? params.workRunId : null,
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 256
  );
}

function invalidRequest(): Response {
  return jsonResponse(
    {
      error: {
        code: 'invalid_request',
        message: 'The browser request is invalid.',
      },
    },
    400,
  );
}

function invalidProductRequest(): Response {
  return jsonResponse(
    {
      error: {
        code: 'invalid_request',
        message: 'The requested Work path is invalid.',
        request_id: 'web-product-bff',
      },
    },
    400,
  );
}

function unavailable(): Response {
  return jsonResponse(
    {
      error: {
        code: 'product_unavailable',
        message: 'Product data could not be loaded.',
        request_id: 'web-product-bff',
      },
    },
    503,
  );
}

function invalidUpstream(): Response {
  return jsonResponse(
    {
      error: {
        code: 'invalid_response',
        message: 'The service returned an invalid response.',
        request_id: 'web-product-bff',
      },
    },
    502,
  );
}

// 502 (not 413): the size problem is not the browser's request, it is this
// gateway's own inability to relay what the authenticated upstream sent --
// the same "bad gateway" class `invalidUpstream()` already uses for a
// response this gateway cannot pass through, kept distinguishable via a
// dedicated code/message so the real cause (too large, not malformed) is
// visible to the caller instead of collapsed into invalid_response.
function upstreamTooLarge(): Response {
  return jsonResponse(
    {
      error: {
        code: 'upstream_response_too_large',
        message:
          'The service response was too large for this gateway to forward.',
        request_id: 'web-product-bff',
      },
    },
    502,
  );
}
