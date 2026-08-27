import type { Hono } from 'hono';
import { z, type ZodType } from 'zod';

import {
  CreateWorkBoardColumnRequestSchema,
  CreateWorkBoardRequestSchema,
  CreateWorkItemCommentRequestSchema,
  CreateWorkItemRequestSchema,
  ErrorResponseSchema,
  PlaceWorkItemRequestSchema,
  PromoteWorkItemRequestSchema,
  UpdateWorkBoardColumnRequestSchema,
  UpdateWorkBoardRequestSchema,
  UpdateWorkItemRequestSchema,
  WorkBoardColumnSchema,
  WorkBoardListResponseSchema,
  WorkBoardPlacementSchema,
  WorkBoardSchema,
  WorkBoardSnapshotSchema,
  WorkItemCommentSchema,
  WorkItemCommentsResponseSchema,
  WorkItemDetailSchema,
  WorkItemListResponseSchema,
} from '../../../contracts/product-accepted-subset/index.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import {
  fetchAuthenticated,
  isUpstreamOversizeResponse,
  jsonResponse,
  readJson,
  safeStatus,
} from './browser-bff-transport.js';

const boardResponseSchema = z.object({ board: WorkBoardSchema }).strict();
const columnResponseSchema = z
  .object({ column: WorkBoardColumnSchema })
  .strict();
const placementResponseSchema = z
  .object({ placement: WorkBoardPlacementSchema })
  .strict();
const commentResponseSchema = z
  .object({ comment: WorkItemCommentSchema })
  .strict();
const emptyResponseSchema = z.null();

export function registerBrowserWorkOrganizationRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
): void {
  app.get('/api/work-items', async () =>
    forward(
      config,
      '/api/v1/work-items',
      { method: 'GET' },
      WorkItemListResponseSchema,
    ),
  );
  app.post('/api/work-items', async (context) => {
    const parsed = CreateWorkItemRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      '/api/v1/work-items',
      'POST',
      parsed.data,
      WorkItemDetailSchema,
      201,
    );
  });
  app.get('/api/work-items/:workItemId', async (context) => {
    const workItemId = context.req.param('workItemId');
    if (!isUuid(workItemId)) return invalidRequest();
    return forward(
      config,
      `/api/v1/work-items/${encodeURIComponent(workItemId)}`,
      { method: 'GET' },
      WorkItemDetailSchema,
      200,
      { notFoundCode: 'task_not_found' },
    );
  });
  app.patch('/api/work-items/:workItemId', async (context) => {
    const workItemId = context.req.param('workItemId');
    if (!isUuid(workItemId)) return invalidRequest();
    const parsed = UpdateWorkItemRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      `/api/v1/work-items/${encodeURIComponent(workItemId)}`,
      'PATCH',
      parsed.data,
      WorkItemDetailSchema,
    );
  });
  app.post('/api/work-items/:workItemId/promote', async (context) => {
    const workItemId = context.req.param('workItemId');
    if (!isUuid(workItemId)) return invalidRequest();
    const parsed = PromoteWorkItemRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      `/api/v1/work-items/${encodeURIComponent(workItemId)}/promote`,
      'POST',
      parsed.data,
      WorkItemDetailSchema,
    );
  });
  app.get('/api/work-items/:workItemId/comments', async (context) => {
    const workItemId = context.req.param('workItemId');
    if (!isUuid(workItemId)) return invalidRequest();
    return forward(
      config,
      `/api/v1/work-items/${encodeURIComponent(workItemId)}/comments`,
      { method: 'GET' },
      WorkItemCommentsResponseSchema,
    );
  });
  app.post('/api/work-items/:workItemId/comments', async (context) => {
    const workItemId = context.req.param('workItemId');
    if (!isUuid(workItemId)) return invalidRequest();
    const parsed = CreateWorkItemCommentRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      `/api/v1/work-items/${encodeURIComponent(workItemId)}/comments`,
      'POST',
      parsed.data,
      commentResponseSchema,
      201,
    );
  });

  app.get('/api/boards', async () =>
    forward(
      config,
      '/api/v1/boards',
      { method: 'GET' },
      WorkBoardListResponseSchema,
    ),
  );
  app.post('/api/boards', async (context) => {
    const parsed = CreateWorkBoardRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      '/api/v1/boards',
      'POST',
      parsed.data,
      boardResponseSchema,
      201,
    );
  });
  app.get('/api/boards/:boardId', async (context) => {
    const boardId = context.req.param('boardId');
    if (!isUuid(boardId)) return invalidRequest();
    return forward(
      config,
      `/api/v1/boards/${encodeURIComponent(boardId)}`,
      { method: 'GET' },
      WorkBoardSnapshotSchema,
      200,
      { notFoundCode: 'board_not_found' },
    );
  });
  app.patch('/api/boards/:boardId', async (context) => {
    const boardId = context.req.param('boardId');
    if (!isUuid(boardId)) return invalidRequest();
    const parsed = UpdateWorkBoardRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      `/api/v1/boards/${encodeURIComponent(boardId)}`,
      'PATCH',
      parsed.data,
      boardResponseSchema,
    );
  });
  app.delete('/api/boards/:boardId', async (context) => {
    const boardId = context.req.param('boardId');
    if (!isUuid(boardId)) return invalidRequest();
    return forward(
      config,
      `/api/v1/boards/${encodeURIComponent(boardId)}`,
      { method: 'DELETE' },
      emptyResponseSchema,
      204,
    );
  });
  app.post('/api/boards/:boardId/columns', async (context) => {
    const boardId = context.req.param('boardId');
    if (!isUuid(boardId)) return invalidRequest();
    const parsed = CreateWorkBoardColumnRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      `/api/v1/boards/${encodeURIComponent(boardId)}/columns`,
      'POST',
      parsed.data,
      columnResponseSchema,
      201,
    );
  });
  app.patch('/api/boards/:boardId/columns/:columnId', async (context) => {
    const boardId = context.req.param('boardId');
    const columnId = context.req.param('columnId');
    if (!isUuid(boardId) || !isUuid(columnId)) return invalidRequest();
    const parsed = UpdateWorkBoardColumnRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      `/api/v1/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}`,
      'PATCH',
      parsed.data,
      columnResponseSchema,
    );
  });
  app.delete('/api/boards/:boardId/columns/:columnId', async (context) => {
    const boardId = context.req.param('boardId');
    const columnId = context.req.param('columnId');
    if (!isUuid(boardId) || !isUuid(columnId)) return invalidRequest();
    return forward(
      config,
      `/api/v1/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}`,
      { method: 'DELETE' },
      emptyResponseSchema,
      204,
    );
  });
  app.put('/api/boards/:boardId/placement', async (context) => {
    const boardId = context.req.param('boardId');
    if (!isUuid(boardId)) return invalidRequest();
    const parsed = PlaceWorkItemRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return invalidRequest();
    return forwardJson(
      config,
      `/api/v1/boards/${encodeURIComponent(boardId)}/placement`,
      'PUT',
      parsed.data,
      placementResponseSchema,
    );
  });
}

async function forwardJson(
  config: AppConfig,
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
  schema: ZodType<unknown>,
  successStatus = 200,
): Promise<Response> {
  return forward(
    config,
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    schema,
    successStatus,
  );
}

async function forward(
  config: AppConfig,
  path: string,
  init: RequestInit,
  successSchema: ZodType<unknown>,
  successStatus = 200,
  options: { readonly notFoundCode?: string } = {},
): Promise<Response> {
  try {
    const upstream = await fetchAuthenticated(config, path, init);
    const body = await readJson(upstream, {
      ...(upstream.status === 204 ? { emptyValue: null } : {}),
    });
    if (isUpstreamOversizeResponse(body)) {
      return jsonResponse(
        {
          error: {
            code: 'upstream_response_too_large',
            message: 'The upstream response was too large.',
          },
        },
        502,
      );
    }
    if (!upstream.ok) {
      if (upstream.status === 404 && options.notFoundCode)
        return jsonResponse(
          {
            error: {
              code: options.notFoundCode,
              message: 'The requested resource was not found.',
            },
          },
          404,
        );
      const decoded = ErrorResponseSchema.safeParse(body);
      return jsonResponse(
        decoded.success
          ? decoded.data
          : {
              error: {
                code: 'upstream_error',
                message: 'The upstream request failed.',
              },
            },
        safeStatus(upstream.status),
      );
    }
    const decoded = successSchema.safeParse(body);
    if (!decoded.success)
      return jsonResponse(
        {
          error: {
            code: 'upstream_decode_failed',
            message:
              'The upstream response did not match the browser contract.',
          },
        },
        502,
      );
    if (successStatus === 204)
      return new Response(null, {
        status: 204,
        headers: { 'cache-control': 'no-store' },
      });
    return jsonResponse(decoded.data, successStatus);
  } catch {
    return jsonResponse(
      {
        error: {
          code: 'browser_gateway_unavailable',
          message: 'The Agent Server browser gateway is unavailable.',
        },
      },
      503,
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
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
