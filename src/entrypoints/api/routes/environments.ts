import type { Hono } from 'hono';
import { HttpError } from '../../../contracts/http.js';
import {
  EnvironmentIdSchema,
  EnvironmentPackageRequestSchema,
  EnvironmentPublishRequestSchema,
  EnvironmentVersionResponseSchema,
} from '../../../contracts/environments.js';
import {
  importEnvironment,
  publishEnvironmentVersion,
  validateEnvironmentPackage,
  EnvironmentPackageValidationError,
} from '../../../application/environments/environment-use-cases.js';
import type { EnvironmentRegistry } from '../../../application/ports/environment-registry.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
export function registerEnvironmentRoutes(
  app: Hono<ApiEnvironment>,
  d: { config: AppConfig; environmentRegistry: EnvironmentRegistry },
) {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/environment-packages:validate', auth);
  app.use('/api/v1/environments:import', auth);
  app.use('/api/v1/environment-versions/*', auth);
  const body = async (c: any) => {
    try {
      return await c.req.json();
    } catch {
      throw new HttpError(
        400,
        'invalid_request',
        'The request body is invalid.',
      );
    }
  };
  app.post('/api/v1/environment-packages:validate', async (c) => {
    const p = EnvironmentPackageRequestSchema.safeParse(await body(c));
    if (!p.success)
      throw new HttpError(
        400,
        'invalid_request',
        'The request body is invalid.',
      );
    try {
      const r = validateEnvironmentPackage(p.data.source);
      return c.json(
        {
          valid: true,
          fingerprint: r.fingerprint,
          metadata: { normalized_name: r.normalizedName },
        },
        200,
      );
    } catch (e) {
      if (e instanceof EnvironmentPackageValidationError)
        throw new HttpError(400, e.code, 'The environment package is invalid.');
      throw e;
    }
  });
  app.post('/api/v1/environments:import', async (c) => {
    const p = EnvironmentPackageRequestSchema.safeParse(await body(c));
    if (!p.success)
      throw new HttpError(
        400,
        'invalid_request',
        'The request body is invalid.',
      );
    try {
      const r = await importEnvironment(d.environmentRegistry, {
        accessContext: getAuthenticatedAccessContext(c),
        idempotencyKey: c.req.header('idempotency-key') ?? '',
        source: p.data.source,
      });
      return c.json(
        {
          result: r.kind,
          definition: def(r.definition),
          version: ver(r.version),
        },
        201,
      );
    } catch (e) {
      return map(e);
    }
  });
  app.get('/api/v1/environment-versions/:id', async (c) => {
    if (!EnvironmentIdSchema.safeParse(c.req.param('id')).success)
      throw new HttpError(400, 'invalid_request', 'The path is invalid.');
    const v = await d.environmentRegistry.findVersion(
      getAuthenticatedAccessContext(c),
      c.req.param('id'),
    );
    if (!v)
      throw new HttpError(
        404,
        'environment_version_not_found',
        'The requested environment version does not exist.',
      );
    return c.json(ver(v), 200);
  });
  app.post('/api/v1/environment-versions/:id:publish', async (c) => {
    const id =
      (c.req.param('id') ||
        c.req.path.match(/environment-versions\/([^:]+):publish/)?.[1]) ??
      '';
    if (!EnvironmentIdSchema.safeParse(id).success)
      throw new HttpError(400, 'invalid_request', 'The path is invalid.');
    if (!EnvironmentPublishRequestSchema.safeParse(await body(c)).success)
      throw new HttpError(
        400,
        'invalid_request',
        'The request body is invalid.',
      );
    try {
      return c.json(
        ver(
          await publishEnvironmentVersion(d.environmentRegistry, {
            accessContext: getAuthenticatedAccessContext(c),
            idempotencyKey: c.req.header('idempotency-key') ?? '',
            versionId: id,
          }),
        ),
        200,
      );
    } catch (e) {
      return map(e);
    }
  });
}
const def = (x: any) => ({
  id: x.id,
  normalized_name: x.normalizedName,
  display_name: x.displayName,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const ver = (x: any) => ({
  id: x.id,
  definition_id: x.definitionId,
  status: x.status,
  display_name: x.displayName,
  fingerprint: x.fingerprint,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
  published_at: x.publishedAt,
  links: {
    self: `/api/v1/environment-versions/${x.id}`,
  },
});
const map = (e: any): never => {
  if (e instanceof EnvironmentPackageValidationError)
    throw new HttpError(400, e.code, 'The request could not be completed.');
  if (e?.message === 'idempotency_conflict')
    throw new HttpError(
      409,
      'idempotency_conflict',
      'The Idempotency-Key cannot be reused with a different request body.',
    );
  if (e?.message === 'not_found')
    throw new HttpError(
      404,
      'environment_version_not_found',
      'The requested environment version does not exist.',
    );
  throw e;
};
