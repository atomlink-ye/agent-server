import { afterEach, expect, it, vi } from 'vitest';

import { productSchemaFor, readProduct } from '@/lib/product-api-bff';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('decodes a Product response, strips additive fields, and marks the fetch', async () => {
  vi.stubEnv('AGENT_SERVER_BASE_URL', 'http://agent-server.test');
  vi.stubEnv('AGENT_SERVER_SERVICE_TOKEN', 'server-only-token');
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ works: [], next_cursor: null, additive: 'ignored' }),
        { status: 200 },
      ),
    );
  vi.stubGlobal('fetch', fetchMock);

  const response = await readProduct(
    '/api/v1/works',
    productSchemaFor('works'),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-agent-server-upstream')).toBe('fetched');
  expect(await response.json()).toEqual({ works: [], next_cursor: null });
  expect(fetchMock).toHaveBeenCalledWith(
    'http://agent-server.test/api/v1/works',
    expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      headers: expect.objectContaining({
        authorization: 'Bearer server-only-token',
      }),
    }),
  );
});

it('returns only a safe error when a known Product field is invalid', async () => {
  vi.stubEnv('AGENT_SERVER_BASE_URL', 'http://agent-server.test');
  vi.stubEnv('AGENT_SERVER_SERVICE_TOKEN', 'server-only-token');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          works: 'wrong',
          next_cursor: null,
          secret: 'hidden',
        }),
        { status: 200 },
      ),
    ),
  );

  const response = await readProduct(
    '/api/v1/works',
    productSchemaFor('works'),
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: {
      code: 'product_unavailable',
      message: 'Product data could not be loaded.',
      request_id: 'web-product-bff',
    },
  });
});

it('decodes a shared non-2xx ErrorResponse without forwarding raw fields', async () => {
  vi.stubEnv('AGENT_SERVER_BASE_URL', 'http://agent-server.test');
  vi.stubEnv('AGENT_SERVER_SERVICE_TOKEN', 'server-only-token');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'work_not_found',
            message: 'The requested Work was not found.',
            request_id: 'request-1',
            raw: 'must not escape',
          },
        }),
        { status: 404 },
      ),
    ),
  );

  const response = await readProduct(
    '/api/v1/works/00000000-0000-4000-8000-000000000001',
    productSchemaFor('work'),
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: {
      code: 'work_not_found',
      message: 'The requested Work was not found.',
      request_id: 'request-1',
    },
  });
});
