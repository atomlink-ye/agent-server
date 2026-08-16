import type { Hono } from 'hono';
import type { ProductProjectionApi } from '../../../application/product-projection/product-projection.js';
import { ProductProjectionNotFoundError } from '../../../application/product-projection/product-projection.js';

import {
  InvalidWorkListCursorError,
  WorkDefinitionValidationError,
  WorkIdentityApi,
} from '../../../application/work/work-identity-api.js';
import {
  UnsupportedWorkCompositionCapabilityError,
  WorkRunInputValidationError,
} from '../../../application/work/start-work-run.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  WorkIdentityConflictError,
  WorkNotFoundError,
  WorkWorkspaceScopeUnavailableError,
} from '../../../domain/work/work.js';
import {
  PendingWorkRunExpiredError,
  WorkRunBindingConflictError,
} from '../../../domain/work/work-run.js';
import type { StartWorkRun } from '../../../application/work/start-work-run.js';
import {
  CreateWorkRequestSchema,
  StartWorkRunRequestSchema,
  WorkListResponseSchema,
  WorkDefinitionResponseSchema,
  WorkRunListResponseSchema,
  toExecutionReceiptResponse,
  toWorkDefinitionResponse,
  toWorkResponse,
  toWorkRunResponse,
} from '../../../contracts/product-work-commands.js';
import { HttpError } from '../../../contracts/http.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';

export interface ProductWorkCommandDependencies {
  readonly config: AppConfig;
  readonly workIdentity: Pick<
    WorkIdentityApi,
    'createWork' | 'listWorks' | 'listWorkRuns' | 'getWorkDefinition'
  >;
  readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
  readonly workExists?: ProductProjectionApi['getWork'];
  readonly workListProjection: ProductProjectionApi['getWorkListItem'];
}

export function registerProductWorkCommandRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: ProductWorkCommandDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  app.use('/api/v1/works', requireServiceAccountAccess(authenticator));
  app.use('/api/v1/works/*', requireServiceAccountAccess(authenticator));

  app.get('/api/v1/works', async (context) => {
    const { limit, cursor } = parseListQuery(context.req.url);
    const accessContext = getAuthenticatedAccessContext(context);
    try {
      const page = await dependencies.workIdentity.listWorks({
        owner: WorkIdentityApi.ownerFromAccessContext(accessContext),
        accessContext,
        limit,
        cursor,
      });
      const works = await Promise.all(
        page.items.map((work) =>
          dependencies.workListProjection({
            tenantId: accessContext.tenantId,
            workspaceId: accessContext.workspaceId,
            work,
          }),
        ),
      );
      return context.json(
        WorkListResponseSchema.parse({
          works,
          next_cursor: page.nextCursor,
        }),
        200,
      );
    } catch (error) {
      if (error instanceof InvalidWorkListCursorError)
        throw new HttpError(400, error.code, error.message);
      if (error instanceof WorkDefinitionValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });

  app.get('/api/v1/works/:workId/definition', async (context) => {
    const workId = context.req.param('workId');
    if (!isCanonicalUuid(workId))
      throw new HttpError(400, 'invalid_request', 'workId must be a UUID.');
    const accessContext = getAuthenticatedAccessContext(context);
    try {
      const binding = await dependencies.workIdentity.getWorkDefinition({
        owner: WorkIdentityApi.ownerFromAccessContext(accessContext),
        accessContext,
        workId,
      });
      return context.json(
        WorkDefinitionResponseSchema.parse(toWorkDefinitionResponse(binding)),
        200,
      );
    } catch (error) {
      if (error instanceof WorkNotFoundError)
        throw new HttpError(
          404,
          'work_not_found',
          'The requested Work was not found.',
        );
      throw error;
    }
  });

  app.get('/api/v1/works/:workId/runs', async (context) => {
    const workId = context.req.param('workId');
    if (!isCanonicalUuid(workId))
      throw new HttpError(400, 'invalid_request', 'workId must be a UUID.');
    const { limit, cursor } = parseListQuery(context.req.url);
    const accessContext = getAuthenticatedAccessContext(context);
    try {
      if (dependencies.workExists) {
        try {
          await dependencies.workExists({
            tenantId: accessContext.tenantId,
            workspaceId: accessContext.workspaceId,
            workId,
          });
        } catch (error) {
          if (error instanceof ProductProjectionNotFoundError)
            throw new HttpError(
              404,
              'work_not_found',
              'The requested Work was not found.',
            );
          throw error;
        }
      }
      const page = await dependencies.workIdentity.listWorkRuns({
        owner: WorkIdentityApi.ownerFromAccessContext(accessContext),
        accessContext,
        workId,
        limit,
        cursor,
      });
      return context.json(
        WorkRunListResponseSchema.parse({
          work_runs: page.items.map(toWorkRunResponse),
          next_cursor: page.nextCursor,
        }),
        200,
      );
    } catch (error) {
      if (error instanceof InvalidWorkListCursorError)
        throw new HttpError(400, error.code, error.message);
      if (error instanceof WorkDefinitionValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });

  app.post('/api/v1/works', async (context) => {
    rejectTechnicalIdempotencyHeader(context);
    const accessContext = getAuthenticatedAccessContext(context);
    const parsed = CreateWorkRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 64 * 1024),
    );
    if (!parsed.success)
      throw new HttpError(
        400,
        'invalid_request',
        'A valid Work request is required.',
      );
    try {
      const work = await dependencies.workIdentity.createWork({
        owner: WorkIdentityApi.ownerFromAccessContext(accessContext),
        accessContext,
        definitionId: parsed.data.definition_id,
        definitionVersionId: parsed.data.definition_version_id,
        title: parsed.data.title,
      });
      return context.json({ work: toWorkResponse(work) }, 201);
    } catch (error) {
      if (error instanceof WorkNotFoundError)
        throw new HttpError(404, 'work_not_found', error.message);
      if (error instanceof WorkIdentityConflictError)
        throw new HttpError(409, 'work_identity_conflict', error.message);
      if (error instanceof WorkWorkspaceScopeUnavailableError)
        throw new HttpError(409, 'workspace_scope_unavailable', error.message);
      if (error instanceof WorkDefinitionValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });

  app.post('/api/v1/works/:workId/runs', async (context) => {
    rejectTechnicalIdempotencyHeader(context);
    const workId = context.req.param('workId');
    if (!isCanonicalUuid(workId))
      throw new HttpError(400, 'invalid_request', 'workId must be a UUID.');
    const accessContext = getAuthenticatedAccessContext(context);
    const parsed = StartWorkRunRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 64 * 1024),
    );
    if (!parsed.success)
      throw new HttpError(
        400,
        'invalid_request',
        'A valid WorkRun request is required.',
      );
    try {
      const result = await dependencies.startWorkRun.execute({
        owner: WorkIdentityApi.ownerFromAccessContext(accessContext),
        accessContext,
        workId,
        triggerKind: parsed.data.trigger_kind,
        ...(parsed.data.trigger_ref !== undefined
          ? { triggerRef: parsed.data.trigger_ref }
          : {}),
        ...(parsed.data.input !== undefined ? { input: parsed.data.input } : {}),
      });
      return context.json(
        {
          work_run: toWorkRunResponse(result.workRun),
          execution_receipt: {
            ...toExecutionReceiptResponse(result.executionReceipt),
          },
        },
        202,
      );
    } catch (error) {
      if (error instanceof WorkRunInputValidationError) {
        const first = error.diagnostics[0];
        return context.json(
          {
            error: {
              code: error.code,
              message: error.message,
              request_id: context.get('requestId'),
              ...(first ? { path: first.path } : {}),
            },
          },
          422,
        );
      }
      if (isCodedError(error, 'work_run_input_conflict'))
        throw new HttpError(
          409,
          'work_run_input_conflict',
          'The WorkRun is already bound to another immutable input snapshot.',
        );
      if (error instanceof WorkNotFoundError)
        throw new HttpError(404, 'work_not_found', error.message);
      if (error instanceof PendingWorkRunExpiredError)
        throw new HttpError(409, 'pending_expired', error.message);
      if (error instanceof WorkRunBindingConflictError)
        throw new HttpError(409, 'work_run_binding_conflict', error.message);
      if (error instanceof UnsupportedWorkCompositionCapabilityError)
        throw new HttpError(409, error.code, error.message);
      if (error instanceof WorkDefinitionValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });
}

function rejectTechnicalIdempotencyHeader(context: {
  req: { header(name: string): string | undefined };
}) {
  if (context.req.header('idempotency-key') !== undefined)
    throw new HttpError(
      400,
      'invalid_request',
      'idempotency-key is not accepted for product Work commands.',
    );
}

function parseListQuery(url: string): {
  readonly limit: number;
  readonly cursor: string | null;
} {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (key !== 'limit' && key !== 'cursor')
      throw new HttpError(
        400,
        'invalid_request',
        'The query parameters are invalid.',
      );
  }
  const limitValues = params.getAll('limit');
  const cursorValues = params.getAll('cursor');
  if (limitValues.length > 1 || cursorValues.length > 1)
    throw new HttpError(
      400,
      'invalid_request',
      'The query parameters are invalid.',
    );
  const cursor = cursorValues[0] ?? null;
  if (cursor === '')
    throw new HttpError(
      400,
      'invalid_cursor',
      'The requested list cursor is invalid.',
    );
  const rawLimit = limitValues[0];
  if (rawLimit === undefined) return { limit: 20, cursor };
  if (!/^(?:0|[1-9][0-9]*)$/.test(rawLimit))
    throw new HttpError(
      400,
      'invalid_limit',
      'The requested list limit is invalid.',
    );
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new HttpError(
      400,
      'invalid_limit',
      'The requested list limit is invalid.',
    );
  return { limit, cursor };
}

function isCodedError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: unknown }).code === code
  );
}

function isCanonicalUuid(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
