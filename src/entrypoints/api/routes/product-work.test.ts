import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
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
    async getWorkRun() {
      throw error;
    },
    async getRunTrace() {
      throw error;
    },
  } as ProductProjectionApi;
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
