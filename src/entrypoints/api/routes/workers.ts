import type { Hono } from 'hono';

import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { importWorker } from '../../../application/workers/import-worker.js';
import { publishWorkerVersion } from '../../../application/workers/publish-worker-version.js';
import { validateWorkerPackage } from '../../../application/workers/validate-worker-package.js';
import {
  WorkerIdempotencyConflictError,
  WorkerNotFoundError,
  WorkerPackageValidationError,
} from '../../../application/workers/errors.js';
import { InvalidIdempotencyKeyError } from '../../../application/agents/errors.js';
import type { WorkerRegistry } from '../../../application/ports/worker-registry.js';
import { HttpError } from '../../../contracts/http.js';
import {
  ImportWorkerResponseSchema,
  MAX_WORKER_REQUEST_BYTES,
  PublishWorkerVersionRequestSchema,
  ValidateWorkerPackageResponseSchema,
  WorkerIdSchema,
  WorkerPackageRequestSchema,
  WorkerVersionResponseSchema,
} from '../../../contracts/workers.js';
import type { AppConfig } from '../../../shared/config.js';
import { getAuthenticatedAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import { readBoundedJson } from '../read-bounded-json.js';

export function registerWorkerRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: {
    readonly config: AppConfig;
    readonly workerRegistry: WorkerRegistry;
  },
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/worker-packages:validate', auth);
  app.use('/api/v1/workers:import', auth);
  app.use('/api/v1/worker-versions/*', auth);

  app.post('/api/v1/worker-packages:validate', async (c) => {
    const input = WorkerPackageRequestSchema.safeParse(await body(c));
    if (!input.success) throw invalidRequest();
    try {
      const result = validateWorkerPackage(input.data.source);
      return c.json(
        ValidateWorkerPackageResponseSchema.parse({
          valid: true,
          fingerprint: result.fingerprint,
          metadata: { normalized_name: result.metadata.normalizedName },
          compiler: {
            pattern_dialect: result.compiler.patternDialect,
            pattern_compiler_version: result.compiler.patternCompilerVersion,
          },
        }),
        200,
      );
    } catch (error) {
      throw mapError(error);
    }
  });

  app.post('/api/v1/workers:import', async (c) => {
    const input = WorkerPackageRequestSchema.safeParse(await body(c));
    if (!input.success) throw invalidRequest();
    try {
      const result = await importWorker(dependencies.workerRegistry, {
        accessContext: getAuthenticatedAccessContext(c),
        idempotencyKey: c.req.header('idempotency-key') ?? '',
        source: input.data.source,
      });
      return c.json(
        ImportWorkerResponseSchema.parse({
          result: result.kind,
          worker: definition(result.definition),
          version: version(result.version),
        }),
        201,
      );
    } catch (error) {
      throw mapError(error);
    }
  });

  app.post('/api/v1/worker-versions/:id:publish', async (c) => {
    const id =
      c.req.param('id') ??
      c.req.path.match(/\/worker-versions\/([^:]+):publish$/)?.[1] ??
      '';
    if (!WorkerIdSchema.safeParse(id).success) throw invalidRequest();
    const input = PublishWorkerVersionRequestSchema.safeParse(await body(c));
    if (!input.success) throw invalidRequest();
    try {
      const published = await publishWorkerVersion(
        dependencies.workerRegistry,
        {
          accessContext: getAuthenticatedAccessContext(c),
          idempotencyKey: c.req.header('idempotency-key') ?? '',
          versionId: id,
        },
      );
      return c.json(WorkerVersionResponseSchema.parse(version(published)), 200);
    } catch (error) {
      throw mapError(error);
    }
  });
}

async function body(c: { req: { raw: Request } }): Promise<unknown> {
  try {
    return await readBoundedJson(c.req.raw, MAX_WORKER_REQUEST_BYTES);
  } catch {
    throw invalidRequest();
  }
}

function invalidRequest(): HttpError {
  return new HttpError(400, 'invalid_request', 'The request body is invalid.');
}

function mapError(error: unknown): Error {
  if (error instanceof HttpError) return error;
  if (error instanceof InvalidIdempotencyKeyError)
    return new HttpError(400, error.code, error.message);
  if (
    error instanceof WorkerIdempotencyConflictError ||
    (error instanceof Error && error.message === 'idempotency_conflict')
  )
    return new HttpError(409, 'worker_idempotency_conflict', error.message);
  if (
    error instanceof WorkerNotFoundError ||
    (error instanceof Error && error.message === 'not_found')
  )
    return new HttpError(404, 'worker_not_found', 'The Worker does not exist.');
  if (error instanceof WorkerPackageValidationError)
    return new HttpError(400, error.code, error.message);
  return error instanceof Error ? error : new Error('Unknown Worker error');
}

function definition(value: {
  id: string;
  normalizedName: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: value.id,
    normalized_name: value.normalizedName,
    display_name: value.displayName,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

function version(value: {
  id: string;
  definitionId: string;
  status: 'draft' | 'published';
  displayName: string;
  fingerprint: string;
  compiler: { patternDialect: string; patternCompilerVersion: string };
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}) {
  return {
    id: value.id,
    definition_id: value.definitionId,
    status: value.status,
    display_name: value.displayName,
    fingerprint: value.fingerprint,
    compiler: {
      pattern_dialect: value.compiler.patternDialect,
      pattern_compiler_version: value.compiler.patternCompilerVersion,
    },
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    published_at: value.publishedAt,
    links: {
      self: `/api/v1/worker-versions/${value.id}`,
      definition: `/api/v1/workers/${value.definitionId}`,
    },
  };
}
