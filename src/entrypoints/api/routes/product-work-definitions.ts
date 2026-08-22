import type { Context, Hono } from 'hono';

import { stringify } from 'yaml';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  InvalidProductWorkDefinitionError,
  ProductWorkDefinitionApi,
  ProductWorkDefinitionIdempotencyConflictError,
  ProductWorkDefinitionNotFoundError,
  ProductWorkDefinitionReferenceError,
} from '../../../application/work/product-work-definition-api.js';
import { validateProductWorkDefinition } from '../../../application/work/validate-product-work-definition.js';
import type { ProductWorkDefinitionVersionRecord } from '../../../application/ports/work-definition-source-repository.js';
import type { WorkDefinitionSourceDefinition } from '../../../domain/work/work-definition-source.js';
import {
  GetProductWorkDefinitionResponseSchema,
  GetProductWorkDefinitionVersionResponseSchema,
  ListProductWorkDefinitionVersionsResponseSchema,
  ProductWorkDefinitionSchema,
  ProductWorkDefinitionVersionSchema,
  ProductWorkDefinitionVersionSummarySchema,
  WorkDefinitionApplyResponseSchema,
  WorkDefinitionPlanResponseSchema,
  WorkDefinitionSourceRequestSchema,
  WorkDefinitionValidateSuccessSchema,
} from '../../../contracts/product-work-definitions.js';
import { HttpError } from '../../../contracts/http.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProductWorkDefinitionRouteDependencies {
  readonly config: AppConfig;
  readonly definitions: ProductWorkDefinitionApi;
}

export function registerProductWorkDefinitionRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: ProductWorkDefinitionRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  for (const path of [
    '/api/v1/work-definitions:validate',
    '/api/v1/work-definitions:plan',
    '/api/v1/work-definitions:apply',
    '/api/v1/work-definitions/*',
    '/api/v1/work-definition-versions/*',
  ])
    app.use(path, requireServiceAccountAccess(authenticator));

  app.post('/api/v1/work-definitions:validate', async (context) => {
    const request = WorkDefinitionSourceRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 64 * 1024),
    );
    if (!request.success) throw invalidRequest();
    const result = validateProductWorkDefinition(request.data.source);
    if (!result.valid) return context.json(result, 422);
    return context.json(
      WorkDefinitionValidateSuccessSchema.parse({
        valid: true,
        fingerprint: result.fingerprint,
        metadata: { normalized_name: result.metadata.normalizedName },
        diagnostics: [],
      }),
      200,
    );
  });

  app.post('/api/v1/work-definitions:plan', async (context) => {
    const request = WorkDefinitionSourceRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 64 * 1024),
    );
    if (!request.success) throw invalidRequest();
    try {
      const result = await dependencies.definitions.plan({
        source: request.data.source,
        accessContext: getAuthenticatedAccessContext(context),
      });
      return context.json(
        WorkDefinitionPlanResponseSchema.parse({
          valid: true,
          fingerprint: result.fingerprint,
          metadata: { normalized_name: result.normalizedName },
          resolved: {
            kind: result.kind,
            participants: result.participants.map((participant) => ({
              name: participant.name,
              role: participant.role,
              source: participant.source,
              agent_version_id: participant.agentVersionId,
              skills: participant.skills,
              tools: participant.tools,
            })),
            environment: {
              source: result.environment.source,
              environment_version_id: result.environment.environmentVersionId,
            },
            memory_version_ids: result.memoryVersionIds,
            required_runtime_capabilities: result.requiredRuntimeCapabilities,
            platform_capabilities: result.platformCapabilities,
            materialization: {
              inline_agents: result.materialization.inlineAgents,
              inline_environment: result.materialization.inlineEnvironment,
              internal_team: result.materialization.internalTeam,
            },
          },
          diagnostics: [],
        }),
        200,
      );
    } catch (error) {
      return mapAuthoringError(context, error);
    }
  });

  app.post('/api/v1/work-definitions:apply', async (context) => {
    const request = WorkDefinitionSourceRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 64 * 1024),
    );
    if (!request.success) throw invalidRequest();
    const idempotencyKey = context.req.header('idempotency-key') ?? '';
    if (!idempotencyKey) throw invalidRequest('Idempotency-Key is required.');
    try {
      const result = await dependencies.definitions.apply({
        source: request.data.source,
        idempotencyKey,
        accessContext: getAuthenticatedAccessContext(context),
      });
      const resolvedFingerprint = result.version.resolvedFingerprint;
      if (!resolvedFingerprint)
        throw new Error('Applied Work Definition has no resolved fingerprint.');
      const version = productVersionResponse(result.version);
      return context.json(
        WorkDefinitionApplyResponseSchema.parse({
          result: result.result,
          definition: productDefinitionResponse(
            result.definition,
            result.version,
          ),
          version,
          resolved: {
            resource_manifest_fingerprint: resolvedFingerprint,
          },
        }),
        result.result === 'created' ? 201 : 200,
      );
    } catch (error) {
      return mapAuthoringError(context, error);
    }
  });

  app.get('/api/v1/work-definitions/:definitionId', async (context) => {
    const definitionId = canonicalUuid(context.req.param('definitionId'));
    try {
      const result = await dependencies.definitions.getDefinition({
        definitionId,
        accessContext: getAuthenticatedAccessContext(context),
      });
      return context.json(
        GetProductWorkDefinitionResponseSchema.parse({
          definition: productDefinitionResponse(
            result.definition,
            result.latestVersion,
          ),
          latest_version: result.latestVersion
            ? productVersionResponse(result.latestVersion)
            : null,
        }),
        200,
      );
    } catch (error) {
      return mapReadError(error);
    }
  });

  app.get(
    '/api/v1/work-definitions/:definitionId/versions',
    async (context) => {
      const definitionId = canonicalUuid(context.req.param('definitionId'));
      const limit = Number(context.req.query('limit') ?? 20);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw invalidRequest('limit must be between 1 and 100.');
      try {
        const page = await dependencies.definitions.listVersions({
          definitionId,
          accessContext: getAuthenticatedAccessContext(context),
          limit,
          cursor: context.req.query('cursor') ?? null,
        });
        return context.json(
          ListProductWorkDefinitionVersionsResponseSchema.parse({
            versions: page.items.map(productVersionSummaryResponse),
            next_cursor: page.nextCursor,
          }),
          200,
        );
      } catch (error) {
        if (isCodedError(error, 'invalid_cursor'))
          throw new HttpError(400, 'invalid_cursor', 'The cursor is invalid.');
        return mapReadError(error);
      }
    },
  );

  app.get('/api/v1/work-definition-versions/:versionId', async (context) => {
    const versionId = canonicalUuid(context.req.param('versionId'));
    try {
      const version = await dependencies.definitions.getVersion({
        versionId,
        accessContext: getAuthenticatedAccessContext(context),
      });
      return context.json(
        GetProductWorkDefinitionVersionResponseSchema.parse({
          version: productVersionResponse(version),
        }),
        200,
      );
    } catch (error) {
      return mapReadError(error);
    }
  });
}

function productDefinitionResponse(
  definition: WorkDefinitionSourceDefinition,
  latest: ProductWorkDefinitionVersionRecord | null,
) {
  const metadata = latest ? sourceMetadata(latest.authorSource) : null;
  return ProductWorkDefinitionSchema.parse({
    id: definition.id,
    normalized_name: definition.name,
    description: metadata?.description ?? definition.description,
    created_at: definition.createdAt,
    latest_version_id: latest?.version.id ?? null,
    links: {
      self: `/api/v1/work-definitions/${definition.id}`,
      versions: `/api/v1/work-definitions/${definition.id}/versions`,
    },
  });
}

function productVersionResponse(record: ProductWorkDefinitionVersionRecord) {
  return ProductWorkDefinitionVersionSchema.parse({
    id: record.version.id,
    definition_id: record.version.definitionId,
    status: 'published',
    fingerprint: record.authorFingerprint,
    source: record.authorSource,
    source_yaml: stringify(record.authorSource, { lineWidth: 0 }),
    resolved: {
      resource_manifest_fingerprint: record.resolvedFingerprint,
    },
    created_at: record.version.createdAt,
    published_at: record.version.publishedAt,
    links: {
      self: `/api/v1/work-definition-versions/${record.version.id}`,
      definition: `/api/v1/work-definitions/${record.version.definitionId}`,
    },
  });
}

function productVersionSummaryResponse(
  record: ProductWorkDefinitionVersionRecord,
) {
  return ProductWorkDefinitionVersionSummarySchema.parse({
    id: record.version.id,
    definition_id: record.version.definitionId,
    status: 'published',
    fingerprint: record.authorFingerprint,
    resolved: {
      resource_manifest_fingerprint: record.resolvedFingerprint,
    },
    created_at: record.version.createdAt,
    published_at: record.version.publishedAt,
    links: {
      self: `/api/v1/work-definition-versions/${record.version.id}`,
      definition: `/api/v1/work-definitions/${record.version.definitionId}`,
    },
  });
}

function sourceMetadata(source: Readonly<Record<string, unknown>>): {
  readonly description: string | null;
} | null {
  const metadata = source.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return null;
  const description = (metadata as Record<string, unknown>).description;
  return {
    description: typeof description === 'string' ? description : null,
  };
}

function mapAuthoringError(
  context: Context<ApiEnvironment>,
  error: unknown,
): Response {
  if (error instanceof InvalidProductWorkDefinitionError)
    return context.json({ valid: false, diagnostics: error.diagnostics }, 422);
  if (error instanceof ProductWorkDefinitionReferenceError)
    return context.json(
      {
        valid: false,
        diagnostics: [
          {
            path: error.path,
            code: error.code,
            message: error.message,
            severity: 'error',
          },
        ],
      },
      422,
    );
  if (error instanceof ProductWorkDefinitionIdempotencyConflictError)
    throw new HttpError(409, error.code, error.message);
  throw error;
}

function mapReadError(error: unknown): never {
  if (error instanceof ProductWorkDefinitionNotFoundError)
    throw new HttpError(404, error.code, error.message);
  throw error;
}

function isCodedError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: unknown }).code === code
  );
}

function canonicalUuid(value: string | undefined): string {
  if (!value || !UUID.test(value))
    throw invalidRequest('A canonical UUID is required.');
  return value;
}

function invalidRequest(
  message = 'A valid Work Definition request is required.',
) {
  return new HttpError(400, 'invalid_request', message);
}
