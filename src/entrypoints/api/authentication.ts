import type { Context, MiddlewareHandler } from 'hono';

import type { ServiceAccountAccessContext } from '../../application/control-plane/access-context.js';
import { ServiceAccountAuthenticator } from '../../application/control-plane/service-account-authenticator.js';
import type { ErrorResponse } from '../../contracts/http.js';
import type { ApiEnvironment } from './http-types.js';

const UNAUTHORIZED_MESSAGE =
  'Authentication is required to access this resource.';

export function requireServiceAccountAccess(
  authenticator: ServiceAccountAuthenticator,
): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const result = authenticator.authenticate(
      context.req.header('authorization'),
    );

    if (!result.ok) {
      context.set('accessContext', null);
      context.header('www-authenticate', 'Bearer');
      return context.json(
        unauthorizedErrorResponse(context.get('requestId')),
        401,
      );
    }

    context.set('accessContext', result.accessContext);
    await next();
  };
}

export function getAuthenticatedAccessContext(
  context: Context<ApiEnvironment>,
): ServiceAccountAccessContext {
  const accessContext = context.get('accessContext');

  if (!accessContext) {
    throw new Error('Authenticated access context is not available');
  }

  return accessContext;
}

export function unauthorizedErrorResponse(requestId: string): ErrorResponse {
  return {
    error: {
      code: 'unauthorized',
      message: UNAUTHORIZED_MESSAGE,
      request_id: requestId,
    },
  };
}
