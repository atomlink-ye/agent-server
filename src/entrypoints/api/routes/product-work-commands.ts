import type { Hono } from 'hono';

import { WorkIdentityApi } from '../../../application/work/work-identity-api.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  WorkIdentityConflictError,
  WorkNotFoundError,
} from '../../../domain/work/work.js';
import {
  PendingWorkRunExpiredError,
  WorkRunBindingConflictError,
} from '../../../domain/work/work-run.js';
import type { StartWorkRun } from '../../../application/work/start-work-run.js';
import { WorkDefinitionValidationError } from '../../../application/work/work-identity-api.js';
import {
  CreateWorkRequestSchema,
  StartWorkRunRequestSchema,
  toExecutionReceiptResponse,
  toWorkResponse,
  toWorkRunResponse,
} from '../../../contracts/product-work-commands.js';
import { HttpError } from '../../../contracts/http.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';

export interface ProductWorkCommandDependencies {
  readonly config: AppConfig;
  readonly workIdentity: Pick<WorkIdentityApi, 'createWork'>;
  readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
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

  app.post('/api/v1/works', async (context) => {
    rejectTechnicalIdempotencyHeader(context);
    const accessContext = getAuthenticatedAccessContext(context);
    const parsed = CreateWorkRequestSchema.safeParse(
      await readBoundedJson(context.req.raw),
    );
    if (!parsed.success)
      throw new HttpError(400, 'invalid_request', 'A valid Work request is required.');
    try {
      const work = await dependencies.workIdentity.createWork({
        owner: WorkIdentityApi.ownerFromAccessContext(
          accessContext,
        ),
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
      if (error instanceof WorkDefinitionValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });

  app.post('/api/v1/works/:workId/runs', async (context) => {
    rejectTechnicalIdempotencyHeader(context);
    const workId = context.req.param('workId');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workId))
      throw new HttpError(400, 'invalid_request', 'workId must be a UUID.');
    const accessContext = getAuthenticatedAccessContext(context);
    const parsed = StartWorkRunRequestSchema.safeParse(
      await readBoundedJson(context.req.raw),
    );
    if (!parsed.success)
      throw new HttpError(400, 'invalid_request', 'A valid WorkRun request is required.');
    try {
      const result = await dependencies.startWorkRun.execute({
        owner: WorkIdentityApi.ownerFromAccessContext(
          accessContext,
        ),
        accessContext,
        workId,
        triggerKind: parsed.data.trigger_kind,
        ...(parsed.data.trigger_ref !== undefined
          ? { triggerRef: parsed.data.trigger_ref }
          : {}),
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
      if (error instanceof WorkNotFoundError)
        throw new HttpError(404, 'work_not_found', error.message);
      if (error instanceof PendingWorkRunExpiredError)
        throw new HttpError(409, 'pending_expired', error.message);
      if (error instanceof WorkRunBindingConflictError)
        throw new HttpError(409, 'work_run_binding_conflict', error.message);
      if (error instanceof WorkDefinitionValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });
}

function rejectTechnicalIdempotencyHeader(context: { req: { header(name: string): string | undefined }; }) {
  if (context.req.header('idempotency-key') !== undefined)
    throw new HttpError(400, 'invalid_request', 'idempotency-key is not accepted for product Work commands.');
}
