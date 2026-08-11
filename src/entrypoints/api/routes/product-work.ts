import type { Context, Hono } from 'hono';
import { z } from 'zod';

import type { ProductProjectionApi } from '../../../application/product-projection/product-projection.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from '../../../contracts/product-projection/index.js';
import { PRODUCT_CONTRACT_STATUS } from '../../../contracts/product-contract-policy.js';
import { HttpError } from '../../../contracts/http.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';

interface ProductWorkRouteDependencies {
  readonly config: AppConfig;
  readonly productProjection: ProductProjectionApi;
}

export function registerProductWorkRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: ProductWorkRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  app.use('/api/v1/works/*', requireServiceAccountAccess(authenticator));

  app.get('/api/v1/works/:workId/runs/:workRunId', async (context) => {
    const input = parsePath(
      context.req.param('workId'),
      context.req.param('workRunId'),
    );
    if (!input) return invalidPath(context, ProductWorkRunResponseSchema);
    try {
      const access = getAuthenticatedAccessContext(context);
      const response = await dependencies.productProjection.getWorkRun({
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        workId: input.workId,
        workRunId: input.workRunId,
      });
      return context.json(ProductWorkRunResponseSchema.parse(response), 200);
    } catch (error) {
      return mapProjectionError(context, error, ProductWorkRunResponseSchema);
    }
  });

  app.get('/api/v1/works/:workId/runs/:workRunId/trace', async (context) => {
    const input = parsePath(
      context.req.param('workId'),
      context.req.param('workRunId'),
    );
    if (!input) return invalidPath(context, ProductRunTraceResponseSchema);
    try {
      const access = getAuthenticatedAccessContext(context);
      const response = await dependencies.productProjection.getRunTrace({
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        workId: input.workId,
        workRunId: input.workRunId,
      });
      return context.json(ProductRunTraceResponseSchema.parse(response), 200);
    } catch (error) {
      return mapProjectionError(context, error, ProductRunTraceResponseSchema);
    }
  });
}

function parsePath(workId: string, workRunId: string) {
  if (
    !z.uuid().safeParse(workId).success ||
    !z.uuid().safeParse(workRunId).success
  )
    return null;
  return { workId, workRunId };
}

function invalidPath(
  context: Context<ApiEnvironment>,
  schema:
    typeof ProductWorkRunResponseSchema | typeof ProductRunTraceResponseSchema,
) {
  return context.json(
    schema.parse({
      contract_status: PRODUCT_CONTRACT_STATUS,
      error: {
        code: 'invalid_request',
        message: 'The Work or WorkRun identifier is invalid.',
      },
    }),
    400,
  );
}

function mapProjectionError(
  context: Context<ApiEnvironment>,
  error: unknown,
  schema:
    typeof ProductWorkRunResponseSchema | typeof ProductRunTraceResponseSchema,
) {
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    ((error as Error).name === 'ProductProjectionNotFoundError' ||
      (error as Error).name === 'ProductProjectionUnavailableError' ||
      (error as Error).name === 'ProductProjectionInvalidError')
  ) {
    const invalid = (error as Error).name === 'ProductProjectionInvalidError';
    const unavailable =
      (error as Error).name === 'ProductProjectionUnavailableError';
    const body = schema.parse({
      contract_status: PRODUCT_CONTRACT_STATUS,
      error: {
        code: invalid
          ? 'projection_invalid'
          : unavailable
            ? 'projection_unavailable'
            : 'work_run_not_found',
        message: invalid
          ? 'The WorkRun projection cannot be represented correctly.'
          : unavailable
            ? 'The WorkRun projection is temporarily unavailable.'
            : 'The WorkRun was not found for the requested workspace.',
        ...(invalid && 'reason' in error ? { reason: error.reason } : {}),
      },
    });
    return context.json(body, invalid ? 500 : unavailable ? 503 : 404);
  }
  if (error instanceof HttpError) throw error;
  throw error;
}
