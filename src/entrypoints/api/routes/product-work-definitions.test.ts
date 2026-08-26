import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { ProductWorkDefinitionApi } from '../../../application/work/product-work-definition-api.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import { ListProductWorkDefinitionsResponseSchema } from '../../../contracts/product-work-definitions.js';
import { registerProductWorkDefinitionRoutes } from './product-work-definitions.js';

const config = {
  serviceAccounts: [
    {
      serviceAccountId: 'svc-1',
      token: 'token-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      policyVersion: 'policy-1',
      disabled: false,
    },
  ],
} as unknown as AppConfig;

const headers = { authorization: 'Bearer token-1' };

describe('Product Work Definition selector route', () => {
  it('returns owner-scoped published definition choices with canonical version ids', async () => {
    const listDefinitions = vi.fn().mockResolvedValue([
      {
        definition: {
          id: '11111111-1111-4111-8111-111111111111',
          owner: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            principalType: 'service_account',
            principalId: 'svc-1',
          },
          name: 'earnings-research',
          description: null,
          createdAt: '2026-08-26T00:00:00.000Z',
        },
        displayName: 'earnings-research',
        currentPublishedVersionId: '22222222-2222-4222-8222-222222222222',
      },
    ]);
    const app = createApp({ listDefinitions });

    const response = await app.request('/api/v1/work-definitions', {
      headers,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      ListProductWorkDefinitionsResponseSchema.safeParse(body).success,
    ).toBe(true);
    expect(body).toEqual({
      items: [
        {
          definition_id: '11111111-1111-4111-8111-111111111111',
          display_name: 'earnings-research',
          current_published_version_id: '22222222-2222-4222-8222-222222222222',
        },
      ],
      next_cursor: null,
    });
    expect(listDefinitions).toHaveBeenCalledWith({
      accessContext: expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'service_account',
        principalId: 'svc-1',
      }),
      limit: 100,
    });
  });

  it('requires service-account authentication', async () => {
    const app = createApp({ listDefinitions: vi.fn() });
    const response = await app.request('/api/v1/work-definitions');

    expect(response.status).toBe(401);
  });
});

function createApp(definitions: {
  readonly listDefinitions: ProductWorkDefinitionApi['listDefinitions'];
}) {
  const app = new Hono<ApiEnvironment>();
  registerProductWorkDefinitionRoutes(app, {
    config,
    definitions: definitions as ProductWorkDefinitionApi,
  });
  return app;
}
