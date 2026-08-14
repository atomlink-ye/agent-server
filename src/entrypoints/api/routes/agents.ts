import type { Hono } from 'hono';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { importAgent } from '../../../application/agents/import-agent.js';
import { publishAgentVersion } from '../../../application/agents/publish-agent-version.js';
import {
  readAgentDefinition,
  readAgentVersion,
  listAgentVersions,
} from '../../../application/agents/read-agent.js';
import { validateAgentPackage } from '../../../application/agents/validate-agent-package.js';
import {
  AgentNotFoundError,
  AgentPackageValidationError,
  IdempotencyConflictError,
  InvalidAgentListCursorError,
  InvalidAgentListLimitError,
  InvalidIdempotencyKeyError,
} from '../../../application/agents/errors.js';
import type { AgentRegistry } from '../../../application/ports/agent-registry.js';
import { HttpError } from '../../../contracts/http.js';
import {
  AgentDefinitionResponseSchema,
  AgentIdSchema,
  AgentVersionListResponseSchema,
  AgentVersionResponseSchema,
  ImportAgentRequestSchema,
  ImportAgentResponseSchema,
  MAX_AGENT_REQUEST_BYTES,
  PublishAgentVersionRequestSchema,
  ValidateAgentPackageRequestSchema,
} from '../../../contracts/agents.js';
import { readBoundedJson } from '../read-bounded-json.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';

interface AgentRouteDependencies {
  readonly config: AppConfig;
  readonly agentRegistry: AgentRegistry;
}
const validatePath = '/api/v1/agent-packages:validate';
const importPath = '/api/v1/agents:import';

export function registerAgentRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: AgentRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  app.use(
    '/api/v1/agent-packages:validate',
    requireServiceAccountAccess(authenticator),
  );
  app.use('/api/v1/agents/*', requireServiceAccountAccess(authenticator));
  app.use('/api/v1/agents:import', requireServiceAccountAccess(authenticator));
  app.use(
    '/api/v1/agent-versions/*',
    requireServiceAccountAccess(authenticator),
  );

  app.post(validatePath, async (c) => {
    const input = ValidateAgentPackageRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_AGENT_REQUEST_BYTES),
    );
    if (!input.success) throw invalidRequest();
    try {
      const result = validateAgentPackage(input.data.source);
      return c.json(
        {
          valid: true,
          fingerprint: result.fingerprint,
          metadata: { normalized_name: result.metadata.normalizedName },
          compiler: {
            pattern_dialect: result.compiler.patternDialect,
            pattern_compiler_version: result.compiler.patternCompilerVersion,
          },
        },
        200,
      );
    } catch (error) {
      if (error instanceof AgentPackageValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });

  app.post(importPath, async (c) => {
    const input = ImportAgentRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_AGENT_REQUEST_BYTES),
    );
    if (!input.success) throw invalidRequest();
    try {
      const result = await importAgent(dependencies.agentRegistry, {
        accessContext: getAuthenticatedAccessContext(c),
        idempotencyKey: c.req.header('idempotency-key') ?? '',
        source: input.data.source,
      });
      const response = {
        result: result.kind,
        agent: definitionResponse(result.definition),
        version: versionResponse(result.version),
      };
      return c.json(ImportAgentResponseSchema.parse(response), 201);
    } catch (error) {
      throw mapAgentError(error);
    }
  });

  app.get('/api/v1/agents/:agentId', async (c) => {
    assertUuidPath(c.req.param('agentId'));
    try {
      return c.json(
        AgentDefinitionResponseSchema.parse(
          definitionResponse(
            await readAgentDefinition(
              dependencies.agentRegistry,
              getAuthenticatedAccessContext(c),
              c.req.param('agentId'),
            ),
          ),
        ),
        200,
      );
    } catch (error) {
      throw mapAgentError(error);
    }
  });
  app.get('/api/v1/agents/:agentId/versions', async (c) => {
    assertUuidPath(c.req.param('agentId'));
    const query = parseVersionListQuery(c.req.url);
    try {
      const page = await listAgentVersions(
        dependencies.agentRegistry,
        getAuthenticatedAccessContext(c),
        {
          definitionId: c.req.param('agentId'),
          cursor: query.cursor,
          limit: query.limit,
        },
      );
      return c.json(
        AgentVersionListResponseSchema.parse({
          items: page.items.map(versionResponse),
          next_cursor: page.nextCursor,
        }),
        200,
      );
    } catch (error) {
      throw mapAgentError(error);
    }
  });
  app.get('/api/v1/agent-versions/:versionId', async (c) => {
    assertUuidPath(c.req.param('versionId'));
    try {
      return c.json(
        AgentVersionResponseSchema.parse(
          versionResponse(
            await readAgentVersion(
              dependencies.agentRegistry,
              getAuthenticatedAccessContext(c),
              c.req.param('versionId'),
            ),
          ),
        ),
        200,
      );
    } catch (error) {
      throw mapAgentError(error);
    }
  });
  app.post('/api/v1/agent-versions/:versionId:publish', async (c) => {
    const versionId =
      c.req.param('versionId') ??
      c.req.path.match(/\/agent-versions\/([^:]+):publish$/)?.[1] ??
      '';
    assertUuidPath(versionId);
    const input = PublishAgentVersionRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_AGENT_REQUEST_BYTES),
    );
    if (!input.success) throw invalidRequest();
    try {
      const version = await publishAgentVersion(dependencies.agentRegistry, {
        accessContext: getAuthenticatedAccessContext(c),
        idempotencyKey: c.req.header('idempotency-key') ?? '',
        versionId,
      });
      return c.json(
        AgentVersionResponseSchema.parse(versionResponse(version)),
        200,
      );
    } catch (error) {
      throw mapAgentError(error);
    }
  });
}

function assertUuidPath(value: string | undefined): asserts value is string {
  if (!AgentIdSchema.safeParse(value).success) throw invalidRequest();
}
function parseVersionListQuery(url: string): {
  cursor: string | null;
  limit: number;
} {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (key !== 'cursor' && key !== 'limit') throw invalidQueryRequest();
  }

  const cursorValues = params.getAll('cursor');
  if (cursorValues.length > 1) throw invalidQueryRequest();
  const cursor = cursorValues.length === 0 ? null : cursorValues[0]!;
  if (cursor === '')
    throw new HttpError(
      400,
      'invalid_cursor',
      'The requested list cursor is invalid.',
    );

  const limitValues = params.getAll('limit');
  if (limitValues.length > 1) throw invalidQueryRequest();
  if (limitValues.length === 0) return { cursor, limit: 20 };
  const rawLimit = limitValues[0]!;
  if (!/^(?:0|[1-9][0-9]*)$/.test(rawLimit)) throw invalidLimit();
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw invalidLimit();
  return { cursor, limit };
}
function invalidQueryRequest(): HttpError {
  return new HttpError(
    400,
    'invalid_request',
    'The query parameters are invalid.',
  );
}
function invalidLimit(): HttpError {
  return new HttpError(
    400,
    'invalid_limit',
    'The requested list limit is invalid.',
  );
}
function invalidRequest(): HttpError {
  return new HttpError(
    400,
    'invalid_request',
    'The request body is invalid and no unknown fields are allowed.',
  );
}
function mapAgentError(error: unknown): Error {
  if (error instanceof HttpError) return error;
  if (error instanceof InvalidIdempotencyKeyError)
    return new HttpError(400, error.code, error.message);
  if (error instanceof IdempotencyConflictError)
    return new HttpError(409, error.code, error.message);
  if (error instanceof AgentNotFoundError)
    return new HttpError(404, 'agent_not_found', error.message);
  if (error instanceof AgentPackageValidationError)
    return new HttpError(400, error.code, error.message);
  if (error instanceof InvalidAgentListLimitError)
    return new HttpError(400, error.code, error.message);
  if (error instanceof InvalidAgentListCursorError)
    return new HttpError(400, error.code, error.message);
  return error instanceof Error ? error : new Error('Unknown agent error');
}
function definitionResponse(value: {
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
    links: {
      self: `/api/v1/agents/${value.id}`,
      versions: `/api/v1/agents/${value.id}/versions`,
    },
  };
}
function versionResponse(value: {
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
      self: `/api/v1/agent-versions/${value.id}`,
      definition: `/api/v1/agents/${value.definitionId}`,
    },
  };
}
