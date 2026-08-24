import type { Context, Hono } from 'hono';
import { z } from 'zod';

import type { GetProductExecutionDetail } from '../../../application/product-projection/get-product-execution-detail.js';
import type { GetProductSessionTranscripts } from '../../../application/product-projection/get-product-session-transcripts.js';
import {
  ProductProjectionNotFoundError,
  type ProductProjectionApi,
} from '../../../application/product-projection/product-projection.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  ProductExecutionDetailResponseSchema,
  ProductSessionTranscriptsResponseSchema,
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from '../../../contracts/product-projection/index.js';
import { ErrorResponseSchema, HttpError } from '../../../contracts/http.js';
import { GetWorkResponseSchema } from '../../../contracts/product-work-commands.js';
import { getAuthenticatedAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';

interface ProductWorkRouteDependencies {
  readonly config: AppConfig;
  readonly productProjection: ProductProjectionApi;
  readonly executionDetail?: Pick<GetProductExecutionDetail, 'execute'>;
  readonly sessionTranscripts?: Pick<GetProductSessionTranscripts, 'execute'>;
}

export function registerProductWorkRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: ProductWorkRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  app.use('/api/v1/works/*', requireServiceAccountAccess(authenticator));

  app.get('/api/v1/works/:workId', async (context) => {
    const workId = context.req.param('workId');
    if (!z.uuid().safeParse(workId).success)
      return context.json(
        ErrorResponseSchema.parse({
          error: {
            code: 'invalid_request',
            message: 'The Work identifier is invalid.',
            request_id: requestId(context),
          },
        }),
        400,
      );
    try {
      const access = getAuthenticatedAccessContext(context);
      const response = await dependencies.productProjection.getWork({
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        workId,
      });
      return context.json(GetWorkResponseSchema.parse(response), 200);
    } catch (error) {
      if (error instanceof ProductProjectionNotFoundError)
        return context.json(
          ErrorResponseSchema.parse({
            error: {
              code: 'work_not_found',
              message: 'The requested Work was not found.',
              request_id: requestId(context),
            },
          }),
          404,
        );
      return mapProjectionError(context, error);
    }
  });

  app.get('/api/v1/works/:workId/runs/:workRunId', async (context) => {
    const input = parsePath(
      context.req.param('workId'),
      context.req.param('workRunId'),
    );
    if (!input) return invalidPath(context);
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
      return mapProjectionError(context, error);
    }
  });

  app.get('/api/v1/works/:workId/runs/:workRunId/trace', async (context) => {
    const input = parsePath(
      context.req.param('workId'),
      context.req.param('workRunId'),
    );
    if (!input) return invalidPath(context);
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
      return mapProjectionError(context, error);
    }
  });

  app.get(
    '/api/v1/works/:workId/runs/:workRunId/execution-detail',
    async (context) => {
      const input = parsePath(
        context.req.param('workId'),
        context.req.param('workRunId'),
      );
      const attemptId = context.req.query('attempt_id');
      if (!input || !attemptId || !z.uuid().safeParse(attemptId).success)
        return invalidPath(context);
      if (!dependencies.executionDetail)
        return context.json(
          ErrorResponseSchema.parse({
            error: {
              code: 'projection_unavailable',
              message: 'Execution detail is temporarily unavailable.',
              request_id: requestId(context),
            },
          }),
          503,
        );
      try {
        const access = getAuthenticatedAccessContext(context);
        const response = await dependencies.executionDetail.execute({
          tenantId: access.tenantId,
          workspaceId: access.workspaceId,
          workId: input.workId,
          workRunId: input.workRunId,
          attemptId,
        });
        return context.json(
          ProductExecutionDetailResponseSchema.parse(response),
          200,
        );
      } catch (error) {
        return mapProjectionError(context, error);
      }
    },
  );

  app.get(
    '/api/v1/works/:workId/runs/:workRunId/session-transcripts',
    async (context) => {
      const input = parsePath(
        context.req.param('workId'),
        context.req.param('workRunId'),
      );
      if (!input) return invalidPath(context);
      if (!dependencies.sessionTranscripts)
        return context.json(
          ErrorResponseSchema.parse({
            error: {
              code: 'projection_unavailable',
              message: 'Session transcripts are temporarily unavailable.',
              request_id: requestId(context),
            },
          }),
          503,
        );
      try {
        const access = getAuthenticatedAccessContext(context);
        const response = await dependencies.sessionTranscripts.execute({
          tenantId: access.tenantId,
          workspaceId: access.workspaceId,
          workId: input.workId,
          workRunId: input.workRunId,
        });
        return context.json(
          ProductSessionTranscriptsResponseSchema.parse(response),
          200,
        );
      } catch (error) {
        return mapProjectionError(context, error);
      }
    },
  );
}

function parsePath(workId: string, workRunId: string) {
  if (
    !z.uuid().safeParse(workId).success ||
    !z.uuid().safeParse(workRunId).success
  )
    return null;
  return { workId, workRunId };
}

function invalidPath(context: Context<ApiEnvironment>) {
  return context.json(
    ErrorResponseSchema.parse({
      error: {
        code: 'invalid_request',
        message: 'The Work, WorkRun, or Attempt identifier is invalid.',
        request_id: requestId(context),
      },
    }),
    400,
  );
}

function mapProjectionError(context: Context<ApiEnvironment>, error: unknown) {
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
    const body = ErrorResponseSchema.parse({
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
        request_id: requestId(context),
      },
    });
    return context.json(body, invalid ? 500 : unavailable ? 503 : 404);
  }
  if (error instanceof HttpError) throw error;
  throw error;
}

function requestId(context: Context<ApiEnvironment>): string {
  return (
    context.get('requestId') ??
    context.req.header('x-request-id') ??
    'product-request'
  );
}
