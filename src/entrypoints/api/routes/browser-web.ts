import type { Hono } from 'hono';
import { z, type ZodType } from 'zod';

import {
  CreateWorkRequestSchema,
  CreateWorkResponseSchema,
  ErrorResponseSchema,
  GetProductWorkDefinitionVersionResponseSchema,
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
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { decodeProductResponse } from '../browser-product-decoder.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

const publicConversationSchema = z.object({
  conversation_id: z.string().min(1),
  kind: z.enum(['direct', 'group']),
  title: z.string().nullable(),
  direct_agent: z
    .object({
      agent_definition_id: z.string().min(1),
      display_name: z.string().nullable(),
    })
    .nullable(),
  topic: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});
const publicConversationMessageSchema = z.object({
  message_id: z.string().min(1),
  conversation_id: z.string().min(1),
  sequence: z.number().int().positive(),
  author_type: z.enum(['principal', 'agent_definition']),
  author_id: z.string().min(1),
  body: z.string().min(1),
  agent_definition_id: z.string().nullable(),
  agent_version_id: z.string().nullable(),
  runtime_epoch: z.number().int().nullable(),
  work_ref: z.string().nullable(),
  created_at: z.string().min(1),
});
const publicChatWorkCardSchema = z.object({
  workId: z.string().min(1),
  workRef: z.string().min(1),
  title: z.string().min(1),
  productState: z.enum([
    'running',
    'needs_you',
    'complete',
    'problem',
    'not_captured',
  ]),
  problemKind: z.enum(['failed', 'cancelled', 'not_captured']).nullable(),
  attentionReason: z
    .enum(['completion_approval_pending', 'not_captured'])
    .nullable(),
  resultSummary: z.string().nullable(),
  resultCaptureStatus: z.enum([
    'present',
    'not_present',
    'redacted',
    'not_captured',
  ]),
});
const conversationListSchema = z.object({
  conversations: z.array(publicConversationSchema),
});
const conversationReadSchema = z.object({ conversation: publicConversationSchema });
const conversationMessagesSchema = z.object({
  messages: z.array(publicConversationMessageSchema),
});
const conversationPostSchema = z.object({
  message: publicConversationMessageSchema,
  dispatch_enqueued: z.boolean(),
});
const createConversationRequestSchema = z
  .object({ agent_definition_id: z.string().trim().min(1).max(256) })
  .strict();
const postConversationRequestSchema = z
  .object({ body: z.string().trim().min(1).max(64 * 1024) })
  .strict();
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
): void {
  app.get('/api/conversations', async () =>
    readBrowserJson(config, '/api/v1/conversations', conversationListSchema),
  );
  app.post('/api/conversations', async (c) => {
    const parsed = createConversationRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return writeBrowserJson(
      config,
      '/api/v1/conversations',
      parsed.data,
      conversationReadSchema,
      { successStatus: 201 },
    );
  });
  app.get('/api/conversations/:conversationId', async (c) => {
    const id = c.req.param('conversationId');
    if (!isId(id)) return invalidRequest();
    return readBrowserJson(
      config,
      `/api/v1/conversations/${encodeURIComponent(id)}`,
      conversationReadSchema,
    );
  });
  app.get('/api/conversations/:conversationId/messages', async (c) => {
    const id = c.req.param('conversationId');
    if (!isId(id)) return invalidRequest();
    return readBrowserJson(
      config,
      `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
      conversationMessagesSchema,
    );
  });
  app.post('/api/conversations/:conversationId/messages', async (c) => {
    const id = c.req.param('conversationId');
    if (!isId(id)) return invalidRequest();
    const parsed = postConversationRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return writeBrowserJson(
      config,
      `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
      parsed.data,
      conversationPostSchema,
      { successStatus: 202 },
    );
  });

  app.get('/api/works', async () =>
    readProductJson(
      config,
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
      `/api/v1/works/${encodeURIComponent(workId)}`,
      GetWorkResponseSchema,
    );
  });
  app.get('/api/works/:workId/chat-card', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidRequest();
    return readBrowserJson(
      config,
      `/api/v1/works/${encodeURIComponent(workId)}/chat-card`,
      publicChatWorkCardSchema,
      { notFoundCode: 'work_not_found' },
    );
  });
  app.get('/api/works/:workId/definition', async (c) => {
    const workId = c.req.param('workId');
    if (!isUuid(workId)) return invalidProductRequest();
    return readProductJson(
      config,
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
      `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}`,
      ProductWorkRunResponseSchema,
    );
  });
  app.get('/api/works/:workId/runs/:workRunId/trace', async (c) => {
    const { workId, workRunId } = workParams(c.req.param());
    if (!workId || !workRunId) return invalidProductRequest();
    return readProductJson(
      config,
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
      `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}/execution-detail?attempt_id=${encodeURIComponent(attemptId)}`,
      ProductExecutionDetailResponseSchema,
    );
  });
  app.get('/api/works/:workId/runs/:workRunId/session-transcripts', async (c) => {
    const { workId, workRunId } = workParams(c.req.param());
    if (!workId || !workRunId) return invalidProductRequest();
    return readProductJson(
      config,
      `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}/session-transcripts`,
      ProductSessionTranscriptsResponseSchema,
    );
  });

  app.get('/api/work-definition-versions/:versionId', async (c) => {
    const versionId = c.req.param('versionId');
    if (!isUuid(versionId)) return invalidProductRequest();
    return readProductJson(
      config,
      `/api/v1/work-definition-versions/${encodeURIComponent(versionId)}`,
      GetProductWorkDefinitionVersionResponseSchema,
    );
  });
  app.post('/api/work-definitions/validate', async (c) =>
    writeWorkDefinition(config, c, 'validate', WorkDefinitionValidateSuccessSchema),
  );
  app.post('/api/work-definitions/plan', async (c) =>
    writeWorkDefinition(config, c, 'plan', WorkDefinitionPlanResponseSchema),
  );
  app.post('/api/work-definitions/apply', async (c) => {
    const idempotencyKey = c.req.header('idempotency-key')?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 256)
      return invalidProductRequest();
    return writeWorkDefinition(
      config,
      c,
      'apply',
      WorkDefinitionApplyResponseSchema,
      idempotencyKey,
    );
  });
}

async function writeWorkDefinition(
  config: AppConfig,
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
  path: string,
  schema: ZodType<unknown>,
): Promise<Response> {
  return forwardDecoded(config, path, { method: 'GET' }, schema, ErrorResponseSchema);
}

async function writeProductJson(
  config: AppConfig,
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
  path: string,
  schema: ZodType<unknown>,
  options: { readonly notFoundCode?: string } = {},
): Promise<Response> {
  return forwardDecoded(
    config,
    path,
    { method: 'GET' },
    schema,
    ErrorResponseSchema,
    options,
  );
}

async function writeBrowserJson(
  config: AppConfig,
  path: string,
  body: unknown,
  schema: ZodType<unknown>,
  options: { readonly successStatus?: number } = {},
): Promise<Response> {
  return forwardDecoded(
    config,
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
  path: string,
  init: RequestInit,
  successSchema: ZodType<unknown>,
  errorSchema: ZodType<unknown>,
  options: {
    readonly successStatus?: number;
    readonly notFoundCode?: string;
  } = {},
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(config, path), {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${browserServiceToken(config)}`,
        ...init.headers,
      },
    });
  } catch {
    return unavailable();
  }
  const body = await upstream.json().catch(() => undefined);
  if (upstream.ok) {
    const decoded = decodeProductResponse(body, successSchema);
    if (!decoded.success) return invalidUpstream();
    return jsonResponse(
      decoded.data,
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
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function invalidRequest(): Response {
  return jsonResponse(
    { error: { code: 'invalid_request', message: 'The browser request is invalid.' } },
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
