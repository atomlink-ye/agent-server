import type { Hono } from 'hono';
import { z } from 'zod';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { HttpError } from '../../../contracts/http.js';
import {
  ListAgentHomeEntries,
  ReadAgentHomeEntry,
  WriteAgentHomeEntry,
  InvalidAgentHomeContentError,
  InvalidAgentHomePathError,
  AgentHomeNamespaceReadOnlyError,
  AgentHomeScopeRequiredError,
} from '../../../application/agents/agent-home.js';
import type { AgentHomeNamespace } from '../../../domain/agents/agent-home.js';
import { AGENT_HOME_NAMESPACES } from '../../../domain/agents/agent-home.js';
import type { AgentHomeRepository } from '../../../application/ports/agent-home-repository.js';
import type { AgentHomeDefinitionSource } from '../../../application/ports/agent-home-definition-source.js';

const MAX_AGENT_HOME_REQUEST_BYTES = 64 * 1024;

export interface AgentHomeRouteDependencies {
  readonly config: AppConfig;
  readonly listAgentHomeEntries: ListAgentHomeEntries;
  readonly readAgentHomeEntry: ReadAgentHomeEntry;
  readonly writeAgentHomeEntry: WriteAgentHomeEntry;
}

const base = '/api/v1/agents';

function scopeParamsFromQuery(c: {
  req: { query: (key: string) => string | undefined };
}): {
  workspaceId?: string;
  conversationId?: string;
  workId?: string;
  runtimeSessionId?: string;
} {
  const params: {
    workspaceId?: string;
    conversationId?: string;
    workId?: string;
    runtimeSessionId?: string;
  } = {};
  const workspaceId = c.req.query('workspace_id');
  if (workspaceId !== undefined) params.workspaceId = workspaceId;
  const conversationId = c.req.query('conversation_id');
  if (conversationId !== undefined) params.conversationId = conversationId;
  const workId = c.req.query('work_id');
  if (workId !== undefined) params.workId = workId;
  const runtimeSessionId = c.req.query('runtime_session_id');
  if (runtimeSessionId !== undefined) params.runtimeSessionId = runtimeSessionId;
  return params;
}

export function registerAgentHomeRoutes(
  app: Hono<ApiEnvironment>,
  d: AgentHomeRouteDependencies,
): void {
  const auth = new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []);
  app.use(`${base}/*`, requireServiceAccountAccess(auth));

  // GET - List entries in a namespace
  app.get(`${base}/:agentDefinitionId/home/:namespace`, async (c) => {
    const agentDefinitionId = c.req.param('agentDefinitionId');
    const namespace = c.req.param('namespace') as AgentHomeNamespace;

    if (!isValidNamespace(namespace)) {
      throw new HttpError(
        400,
        'invalid_request',
        'The namespace is invalid.',
      );
    }

    try {
      const entries = await d.listAgentHomeEntries.execute({
        accessContext: getAuthenticatedAccessContext(c),
        agentDefinitionId,
        namespace,
        scopeParams: scopeParamsFromQuery(c),
      });

      if (!entries) throw notFound();
      return c.json(
        {
          entries: entries.map(toEntry),
        },
        200,
      );
    } catch (e) {
      if (
        e instanceof InvalidAgentHomePathError ||
        e instanceof InvalidAgentHomeContentError
      )
        throw invalid();
      if (e instanceof AgentHomeScopeRequiredError)
        throw new HttpError(400, 'scope_required', e.message);
      if (e instanceof AgentHomeNamespaceReadOnlyError)
        throw new HttpError(403, 'namespace_read_only', e.message);
      throw e;
    }
  });

  // GET - Read a single entry
  app.get(
    `${base}/:agentDefinitionId/home/:namespace/entries/*`,
    async (c) => {
      const agentDefinitionId = c.req.param('agentDefinitionId');
      const namespace = c.req.param('namespace') as AgentHomeNamespace;
      const path = extractPathFromRequest(c);

      if (!isValidNamespace(namespace)) {
        throw new HttpError(
          400,
          'invalid_request',
          'The namespace is invalid.',
        );
      }

      try {
        const entry = await d.readAgentHomeEntry.execute({
          accessContext: getAuthenticatedAccessContext(c),
          agentDefinitionId,
          namespace,
          scopeParams: scopeParamsFromQuery(c),
          path,
        });

        if (!entry) throw notFound();
        return c.json({ entry: toEntry(entry) }, 200);
      } catch (e) {
        if (
          e instanceof InvalidAgentHomePathError ||
          e instanceof InvalidAgentHomeContentError
        )
          throw invalid();
        if (e instanceof AgentHomeScopeRequiredError)
          throw new HttpError(400, 'scope_required', e.message);
        if (e instanceof AgentHomeNamespaceReadOnlyError)
          throw new HttpError(403, 'namespace_read_only', e.message);
        throw e;
      }
    },
  );

  // PUT - Write a single entry
  app.put(
    `${base}/:agentDefinitionId/home/:namespace/entries/*`,
    async (c) => {
      const agentDefinitionId = c.req.param('agentDefinitionId');
      const namespace = c.req.param('namespace') as AgentHomeNamespace;
      const path = extractPathFromRequest(c);

      if (!isValidNamespace(namespace)) {
        throw new HttpError(
          400,
          'invalid_request',
          'The namespace is invalid.',
        );
      }

      const parsed = z
        .object({
          content: z.string(),
        })
        .safeParse(
          await readBoundedJson(c.req.raw, MAX_AGENT_HOME_REQUEST_BYTES),
        );

      if (!parsed.success) throw invalid();

      try {
        const entry = await d.writeAgentHomeEntry.execute({
          accessContext: getAuthenticatedAccessContext(c),
          agentDefinitionId,
          namespace,
          scopeParams: scopeParamsFromQuery(c),
          path,
          content: parsed.data.content,
        });

        if (!entry) throw notFound();
        return c.json({ entry: toEntry(entry) }, 201);
      } catch (e) {
        if (
          e instanceof InvalidAgentHomePathError ||
          e instanceof InvalidAgentHomeContentError
        )
          throw invalid();
        if (e instanceof AgentHomeScopeRequiredError)
          throw new HttpError(400, 'scope_required', e.message);
        if (e instanceof AgentHomeNamespaceReadOnlyError)
          throw new HttpError(403, 'namespace_read_only', e.message);
        throw e;
      }
    },
  );
}

function isValidNamespace(namespace: unknown): namespace is AgentHomeNamespace {
  return (AGENT_HOME_NAMESPACES as readonly unknown[]).includes(namespace);
}

function extractPathFromRequest(c: {
  req: { path: string; param: (key: string) => string };
}): string {
  const namespace = c.req.param('namespace');
  const agentDefinitionId = c.req.param('agentDefinitionId');
  const basePath = `/api/v1/agents/${agentDefinitionId}/home/${namespace}/entries/`;
  const fullPath = c.req.path;
  const path = fullPath.substring(basePath.length);
  return path;
}

function invalid(): HttpError {
  return new HttpError(400, 'invalid_request', 'The request is invalid.');
}

function notFound(): HttpError {
  return new HttpError(
    404,
    'not_found',
    'The requested resource does not exist.',
  );
}

function toEntry(e: {
  id: string;
  path: string;
  currentVersion: number;
  content: string;
  contentSha256: string;
  contentSizeBytes: number;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: e.id,
    path: e.path,
    current_version: e.currentVersion,
    content: e.content,
    content_sha256: e.contentSha256,
    content_size_bytes: e.contentSizeBytes,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}
