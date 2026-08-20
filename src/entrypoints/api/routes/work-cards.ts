import type { Context, Hono } from 'hono';
import { z } from 'zod';

import {
  ChatWorkCardNotFoundError,
  ChatWorkCardUnavailableError,
  type ChatWorkCardProjection,
} from '../../../application/product-projection/chat-work-card-projection.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { ErrorResponseSchema } from '../../../contracts/http.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';

export interface WorkCardRouteDependencies {
  readonly config: AppConfig;
  readonly chatWorkCard: Pick<ChatWorkCardProjection, 'getByWorkId'>;
}

export function registerWorkCardRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: WorkCardRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  app.use('/api/v1/works/*', requireServiceAccountAccess(authenticator));

  app.get('/api/v1/works/:workId/chat-card', async (context) => {
    const workId = context.req.param('workId');
    if (!z.uuid().safeParse(workId).success)
      return errorResponse(context, 400, {
        code: 'invalid_request',
        message: 'The Work identifier is invalid.',
      });

    try {
      const access = getAuthenticatedAccessContext(context);
      const card = await dependencies.chatWorkCard.getByWorkId({
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        workId,
      });
      return context.json(card, 200);
    } catch (error) {
      if (error instanceof ChatWorkCardNotFoundError)
        return errorResponse(context, 404, {
          code: 'work_not_found',
          message: 'The requested Work was not found.',
        });
      if (error instanceof ChatWorkCardUnavailableError)
        return errorResponse(context, 503, {
          code: 'projection_unavailable',
          message: 'The Work Chat card projection is temporarily unavailable.',
        });
      return errorResponse(context, 503, {
        code: 'projection_unavailable',
        message: 'The Work Chat card projection is temporarily unavailable.',
      });
    }
  });
}

function errorResponse(
  context: Context<ApiEnvironment>,
  status: 400 | 404 | 503,
  error: { readonly code: string; readonly message: string },
) {
  return context.json(
    ErrorResponseSchema.parse({
      error: {
        ...error,
        request_id: requestId(context),
      },
    }),
    status,
  );
}

function requestId(context: Context<ApiEnvironment>): string {
  return (
    context.get('requestId') ??
    context.req.header('x-request-id') ??
    'work-card-request'
  );
}
