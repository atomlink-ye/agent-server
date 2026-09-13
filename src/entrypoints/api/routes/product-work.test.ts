import { HttpError } from '../../../contracts/http.js';
import { WorkChatRequestConflictError } from '../../../application/ports/work-chat-repository.js';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  ProductProjectionNotFoundError,
  ProductProjectionInvalidError,
  ProductProjectionUnavailableError,
  type ProductProjectionApi,
} from '../../../application/product-projection/product-projection.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import { registerProductWorkRoutes } from './product-work.js';

const workId = '00000000-0000-4000-8000-000000000001';
const workRunId = '00000000-0000-4000-8000-000000000002';

describe('product Work trace failure semantics', () => {
  it('distinguishes transient unavailability from both non-retryable invariant failures', async () => {
    const errors = [
      new ProductProjectionUnavailableError(),
      new ProductProjectionInvalidError('event_page_limit'),
      new ProductProjectionInvalidError('event_page_order_invalid'),
    ];
    const observed = [];

    for (const error of errors) {
      const app = createTestApp(error);
      const response = await app.request(
        `/api/v1/works/${workId}/runs/${workRunId}/trace`,
        { headers: { authorization: 'Bearer token' } },
      );
      observed.push({ status: response.status, body: await response.json() });
    }

    expect(observed).toEqual([
      {
        status: 503,
        body: expect.objectContaining({
          error: expect.objectContaining({ code: 'projection_unavailable' }),
        }),
      },
      {
        status: 500,
        body: expect.objectContaining({
          error: expect.objectContaining({
            code: 'projection_invalid',
            message: expect.any(String),
            request_id: expect.any(String),
          }),
        }),
      },
      {
        status: 500,
        body: expect.objectContaining({
          error: expect.objectContaining({
            code: 'projection_invalid',
            message: expect.any(String),
            request_id: expect.any(String),
          }),
        }),
      },
    ]);
  });
});

function createTestApp(error: Error) {
  const app = new Hono<ApiEnvironment>();
  const productProjection = {
    async getWork() {
      throw error;
    },
    async getWorkRun() {
      throw error;
    },
    async getRunTrace() {
      throw error;
    },
  } as unknown as ProductProjectionApi;
  registerProductWorkRoutes(app, {
    config: {
      serviceAccounts: [
        {
          serviceAccountId: 'test',
          token: 'token',
          tenantId: 'tenant',
          workspaceId: 'workspace',
          policyVersion: 'test',
          disabled: false,
        },
      ],
    } as unknown as AppConfig,
    productProjection,
  });
  return app;
}

it('routes each Run chat operation through owner-scoped Run validation', async () => {
  const app = new Hono<ApiEnvironment>();
  app.onError((error, context) =>
    error instanceof HttpError
      ? context.json({ error: { code: error.code } }, error.status)
      : context.json({ error: { code: 'unexpected' } }, 500),
  );
  const getWorkRun = vi.fn().mockResolvedValue({});
  const list = vi
    .fn()
    .mockResolvedValue({ messages: [], nextBeforeSequence: null });
  const message = {
    id: workRunId,
    workRunId,
    sequence: 1,
    kind: 'user',
    body: 'hello',
    status: 'queued',
    replyToMessageId: null,
    failureCode: null,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  const post = vi.fn().mockResolvedValue({ message, replayed: false });
  const retry = vi.fn().mockResolvedValue(message);
  registerProductWorkRoutes(app, {
    config: {
      serviceAccounts: [
        {
          serviceAccountId: 'test',
          token: 'token',
          tenantId: 'tenant',
          workspaceId: 'workspace',
          policyVersion: 'test',
          disabled: false,
        },
      ],
    } as unknown as AppConfig,
    productProjection: {
      getWork: vi.fn(),
      getWorkRun,
    } as unknown as ProductProjectionApi,
    workChat: { listPage: list, post, retry } as any,
  });
  const base = `/api/v1/works/${workId}/runs/${workRunId}/chat`;
  for (const [path, method] of [
    [base, 'GET'],
    [base, 'POST'],
    [`${base}/${workRunId}/retry`, 'POST'],
  ] as const) {
    const response = await app.request(path!, {
      method,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      ...(method === 'POST'
        ? { body: JSON.stringify({ body: 'hello', client_request_id: 'key' }) }
        : {}),
    });
    expect(response.status).toBe(method === 'GET' ? 200 : 202);
  }
  expect(getWorkRun).toHaveBeenCalledWith({
    tenantId: 'tenant',
    workspaceId: 'workspace',
    workId,
    workRunId,
  });
  for (const method of [list, post, retry])
    expect(method).toHaveBeenCalledWith(
      expect.objectContaining({ workId, workRunId }),
    );
  list.mockResolvedValueOnce({ messages: [message], nextBeforeSequence: 1 });
  const firstPage = await app.request(`${base}?limit=25`, {
    headers: { authorization: 'Bearer token' },
  });
  expect(firstPage.status).toBe(200);
  const firstPageBody = (await firstPage.json()) as {
    next_cursor: string | null;
  };
  expect(firstPageBody.next_cursor).toEqual(expect.any(String));
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ limit: 25, beforeSequence: undefined }),
  );
  await app.request(
    `${base}?cursor=${encodeURIComponent(firstPageBody.next_cursor!)}`,
    { headers: { authorization: 'Bearer token' } },
  );
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ limit: 200, beforeSequence: 1 }),
  );
  list.mockClear();
  getWorkRun.mockRejectedValueOnce(new ProductProjectionNotFoundError());
  expect(
    (await app.request(base, { headers: { authorization: 'Bearer token' } }))
      .status,
  ).toBe(404);
  expect(list).not.toHaveBeenCalled();
  expect(
    (
      await app.request(base.replace(workRunId, 'invalid'), {
        headers: { authorization: 'Bearer token' },
      })
    ).status,
  ).toBe(400);
  expect((await app.request(base)).status).toBe(401);
  post.mockRejectedValueOnce(new WorkChatRequestConflictError());
  expect(
    (
      await app.request(base, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body: 'hello', client_request_id: 'key' }),
      })
    ).status,
  ).toBe(409);
  const preparation = await app.request(`/api/v1/works/${workId}/chat`, {
    headers: { authorization: 'Bearer token' },
  });
  expect(preparation.status).toBe(200);
  expect(await preparation.json()).toMatchObject({
    work_run_id: null,
    messages: [],
  });
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ workId, workRunId: undefined }),
  );
});
