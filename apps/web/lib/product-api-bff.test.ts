import { afterEach, expect, it, vi } from 'vitest';

import {
  productSchemaFor,
  readProduct,
  workDefinitionAuthoringErrorSchema,
  writeProduct,
} from '@/lib/product-api-bff';
import {
  GetProductWorkDefinitionVersionResponseSchema,
  WorkDefinitionApplyResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function configureProductApi() {
  vi.stubEnv('AGENT_SERVER_BASE_URL', 'http://agent-server.test');
  vi.stubEnv('AGENT_SERVER_SERVICE_TOKEN', 'server-only-token');
}

it('decodes a Product response, strips additive fields, and marks the fetch', async () => {
  configureProductApi();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ works: [], next_cursor: null, additive: 'ignored' }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const response = await readProduct('/api/v1/works', productSchemaFor('works'));

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-agent-server-upstream')).toBe('fetched');
  expect(await response.json()).toEqual({ works: [], next_cursor: null });
  expect(fetchMock).toHaveBeenCalledWith(
    'http://agent-server.test/api/v1/works',
    expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      headers: expect.objectContaining({ authorization: 'Bearer server-only-token' }),
    }),
  );
});

it('allows the exact Product DefinitionVersion read used by the authoring surface', async () => {
  configureProductApi();
  const versionId = '00000000-0000-4000-8000-000000000001';
  const definitionId = '00000000-0000-4000-8000-000000000002';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: {
            id: versionId,
            definition_id: definitionId,
            status: 'published',
            fingerprint: `sha256:${'a'.repeat(64)}`,
            source: { metadata: { name: 'demo' }, spec: { kind: 'single_agent' } },
            resolved: { resource_manifest_fingerprint: null },
            created_at: '2026-01-01T00:00:00.000Z',
            published_at: '2026-01-01T00:00:00.000Z',
            links: {
              self: `/api/v1/work-definition-versions/${versionId}`,
              definition: `/api/v1/work-definitions/${definitionId}`,
            },
          },
        }),
        { status: 200 },
      ),
    ),
  );

  const response = await readProduct(
    `/api/v1/work-definition-versions/${versionId}`,
    GetProductWorkDefinitionVersionResponseSchema,
  );
  expect(response.status).toBe(200);
  expect((await response.json()).version.id).toBe(versionId);
});

it('forwards the apply idempotency key and preserves path-aware diagnostics', async () => {
  configureProductApi();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        valid: false,
        diagnostics: [
          {
            path: '$.spec',
            code: 'invalid_work_definition',
            message: 'spec is invalid',
            severity: 'error',
          },
        ],
      }),
      { status: 422 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const response = await writeProduct(
    '/api/v1/work-definitions:apply',
    { source: 'kind: WorkDefinition' },
    WorkDefinitionApplyResponseSchema,
    {
      idempotencyKey: 'apply-1',
      errorSchema: workDefinitionAuthoringErrorSchema,
    },
  );

  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    valid: false,
    diagnostics: [{ path: '$.spec', code: 'invalid_work_definition' }],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'http://agent-server.test/api/v1/work-definitions:apply',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer server-only-token',
        'idempotency-key': 'apply-1',
      }),
    }),
  );
});

it('returns only a safe error when a known Product field is invalid', async () => {
  configureProductApi();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ works: 'wrong', next_cursor: null, secret: 'hidden' }),
        { status: 200 },
      ),
    ),
  );

  const response = await readProduct('/api/v1/works', productSchemaFor('works'));

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
  configureProductApi();
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
