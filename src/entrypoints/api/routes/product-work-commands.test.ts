import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '../../../contracts/http.js';
import { WorkWorkspaceScopeUnavailableError } from '../../../domain/work/work.js';
import type { WorkIdentityApi } from '../../../application/work/work-identity-api.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import {
  registerProductWorkCommandRoutes,
  type ProductWorkCommandDependencies,
} from './product-work-commands.js';

const config = {
  serviceAccounts: [
    {
      serviceAccountId: 'svc-1',
      token: 'token-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace_main',
      policyVersion: 'policy-1',
      disabled: false,
    },
  ],
} as unknown as AppConfig;

describe('product Work command route', () => {
  it('maps an unavailable authenticated workspace scope to an informative conflict', async () => {
    const createWork = vi
      .fn()
      .mockRejectedValue(
        new WorkWorkspaceScopeUnavailableError(),
      ) as unknown as WorkIdentityApi['createWork'];
    const app = createApp(createWork);
    const response = await app.request('/api/v1/works', {
      method: 'POST',
      headers,
      body: JSON.stringify(validRequest()),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'workspace_scope_unavailable',
        message: 'The authenticated workspace scope is not provisioned.',
      },
    });
  });

  it('preserves unrelated persistence failures as internal errors', async () => {
    const createWork = vi
      .fn()
      .mockRejectedValue(
        new Error('db unavailable'),
      ) as unknown as WorkIdentityApi['createWork'];
    const app = createApp(createWork);
    const response = await app.request('/api/v1/works', {
      method: 'POST',
      headers,
      body: JSON.stringify(validRequest()),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: 'internal_error',
        message: 'The request could not be completed.',
      },
    });
  });
});

function createApp(
  createWork: ProductWorkCommandDependencies['workIdentity']['createWork'],
) {
  const app = new Hono<ApiEnvironment>();
  registerProductWorkCommandRoutes(app, {
    config,
    workIdentity: {
      createWork,
      listWorks: vi.fn(),
      listWorkRuns: vi.fn(),
    },
    startWorkRun: { execute: vi.fn() },
  });
  app.onError((error, context) => {
    if (error instanceof HttpError)
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return context.json(
      {
        error: {
          code: 'internal_error',
          message: 'The request could not be completed.',
        },
      },
      500,
    );
  });
  return app;
}

function validRequest() {
  return {
    definition_id: '00000000-0000-4000-8000-000000000301',
    definition_version_id: '00000000-0000-4000-8000-000000000302',
    title: 'Work',
  };
}

const headers = {
  authorization: 'Bearer token-1',
  'content-type': 'application/json',
};
