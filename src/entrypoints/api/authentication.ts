import type { MiddlewareHandler } from 'hono';

import { ServiceAccountAuthenticator } from '../../application/control-plane/service-account-authenticator.js';
import { issueUserAccessContext } from '../../application/control-plane/user-principal-issuer.js';
import type { ErrorResponse } from '../../contracts/http.js';
import { USER_ID_HEADER } from './access-context.js';
import type { ApiEnvironment } from './http-types.js';

export {
  getAuthenticatedAccessContext,
  getRequestAccessContext,
  USER_ID_HEADER,
} from './access-context.js';

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
      context.set('userAccessContext', null);
      context.header('www-authenticate', 'Bearer');
      return context.json(
        unauthorizedErrorResponse(context.get('requestId')),
        401,
      );
    }

    context.set('accessContext', result.accessContext);
    context.set(
      'userAccessContext',
      resolveUserAccessContext(
        result.accessContext,
        context.req.header(USER_ID_HEADER),
      ),
    );
    await next();
  };
}

function resolveUserAccessContext(
  serviceAccountContext: Parameters<typeof issueUserAccessContext>[0],
  userIdHeader: string | undefined,
) {
  const userId = userIdHeader?.trim();
  return userId ? issueUserAccessContext(serviceAccountContext, userId) : null;
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
