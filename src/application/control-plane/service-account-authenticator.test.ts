import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../../entrypoints/api/authentication.js';
import type { ApiEnvironment } from '../../entrypoints/api/http-types.js';
import { ServiceAccountAuthenticator } from './service-account-authenticator.js';

describe('ServiceAccountAuthenticator', () => {
  it('does not authenticate disabled service accounts', () => {
    const authenticator = new ServiceAccountAuthenticator([
      {
        serviceAccountId: 'svc_disabled',
        token: 'token-disabled',
        tenantId: 'tenant_alpha',
        workspaceId: 'workspace_main',
        policyVersion: 'policy-2026-07-22',
        disabled: true,
      },
    ]);

    expect(authenticator.authenticate('Bearer token-disabled')).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  it('resolves a canonical service-account access context in request context', async () => {
    const response = await createProtectedApp().request('/protected', {
      headers: {
        authorization: 'Bearer token-enabled',
        'x-request-id': 'req-canonical',
        'x-tenant-id': 'forged-tenant',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      principalType: 'service_account',
      principalId: 'svc_enabled',
      serviceAccountId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    });
  });

  it('returns the same public unauthorized response for missing malformed unknown and disabled credentials', async () => {
    const app = createProtectedApp();

    const responses = await Promise.all([
      app.request('/protected', {
        headers: { 'x-request-id': 'req-unauthorized' },
      }),
      app.request('/protected', {
        headers: {
          authorization: 'Basic token-enabled',
          'x-request-id': 'req-unauthorized',
        },
      }),
      app.request('/protected', {
        headers: {
          authorization: 'Bearer token-unknown',
          'x-request-id': 'req-unauthorized',
        },
      }),
      app.request('/protected', {
        headers: {
          authorization: 'Bearer token-disabled',
          'x-request-id': 'req-unauthorized',
        },
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(await response.json()).toEqual({
        error: {
          code: 'unauthorized',
          message: 'Authentication is required to access this resource.',
          request_id: 'req-unauthorized',
        },
      });
    }
  });
});

function createProtectedApp(): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  const authenticator = new ServiceAccountAuthenticator([
    {
      serviceAccountId: 'svc_enabled',
      token: 'token-enabled',
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      policyVersion: 'policy-2026-07-22',
      disabled: false,
    },
    {
      serviceAccountId: 'svc_disabled',
      token: 'token-disabled',
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      policyVersion: 'policy-2026-07-22',
      disabled: true,
    },
  ]);

  app.use('*', async (context, next) => {
    context.set(
      'requestId',
      context.req.header('x-request-id') ?? 'req-default',
    );
    context.set('accessContext', null);
    await next();
  });

  app.use('/protected', requireServiceAccountAccess(authenticator));
  app.get('/protected', (context) =>
    context.json(getAuthenticatedAccessContext(context), 200),
  );

  return app;
}
