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
  AgentVersionListResponseSchema,
  AgentVersionResponseSchema,
  ImportAgentRequestSchema,
  ImportAgentResponseSchema,
  MAX_AGENT_REQUEST_BYTES,
  PublishAgentVersionRequestSchema,
  ValidateAgentPackageRequestSchema,
} from '../../../contracts/agents.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';

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
      await readJson(c.req.raw),
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
    const input = ImportAgentRequestSchema.safeParse(await readJson(c.req.raw));
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
    const limit =
      c.req.query('limit') === undefined ? 20 : Number(c.req.query('limit'));
    try {
      const page = await listAgentVersions(
        dependencies.agentRegistry,
        getAuthenticatedAccessContext(c),
        {
          definitionId: c.req.param('agentId'),
          cursor: c.req.query('cursor') ?? null,
          limit,
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
    const input = PublishAgentVersionRequestSchema.safeParse(
      await readJson(c.req.raw),
    );
    if (!input.success) throw invalidRequest();
    try {
      const versionId =
        c.req.param('versionId') ??
        c.req.path.match(/\/agent-versions\/([^:]+):publish$/)?.[1] ??
        '';
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

async function readJson(request: Request): Promise<unknown> {
  const declared = Number.parseInt(
    request.headers.get('content-length') ?? '0',
    10,
  );
  if (Number.isFinite(declared) && declared > MAX_AGENT_REQUEST_BYTES)
    throw new HttpError(
      413,
      'request_too_large',
      'The request body exceeds 64 KiB.',
    );
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_AGENT_REQUEST_BYTES)
    throw new HttpError(
      413,
      'request_too_large',
      'The request body exceeds 64 KiB.',
    );
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError(
      400,
      'invalid_json',
      'The request body is not valid JSON.',
    );
  }
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
