import type { Hono } from 'hono';
import { z } from 'zod';

import type { LogicalFileStore } from '../../../application/ports/logical-file-store.js';
import type { ContextPromotionService } from '../../../application/context/context-promotion-service.js';
import {
  agentContextScope,
  agentUserContextScope,
  conversationContextScope,
  organizationContextScope,
  workContextScope,
  workspaceContextScope,
  type ContextScope,
} from '../../../domain/context/context-fs.js';
import { principalRef } from '../../../domain/tenancy/product-context.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';
import { HttpError } from '../../../contracts/http.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';

const BASE = '/api/v1/context';
const MAX_REQUEST_BYTES = 64 * 1024;
const scopeKindSchema = z.enum([
  'organization',
  'workspace',
  'agent',
  'agent_user',
  'conversation',
  'work',
]);

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly T[]; readonly rowCount?: number | null }>;
}

export interface ContextFileRouteDependencies {
  readonly config: AppConfig;
  readonly database: Queryable;
  readonly files: LogicalFileStore;
  readonly promotions: Pick<
    ContextPromotionService,
    | 'promoteConversationToAgentUser'
    | 'admitConversationToWork'
    | 'publishWorkResult'
    | 'pinMemoryToAgent'
  >;
}

export function registerContextFileRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: ContextFileRouteDependencies,
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use(`${BASE}/*`, auth);

  app.get(`${BASE}/files`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const requested = parseScopeRequest(new URL(c.req.url).searchParams);
    const resolved = await resolveScope(dependencies.database, access, requested);
    const entries = await dependencies.files.list(resolved.scope);
    return c.json({
      scope: scopeResponse(resolved.scope),
      access: resolved.access,
      entries: entries.map((entry) => ({
        id: entry.id,
        path: entry.path,
        current_version: entry.currentVersion,
        content_sha256: entry.contentSha256,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
      })),
    });
  });

  app.get(`${BASE}/file`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const params = new URL(c.req.url).searchParams;
    const path = requiredParam(params, 'path');
    const requested = parseScopeRequest(params);
    const resolved = await resolveScope(dependencies.database, access, requested);
    const entry = await dependencies.files.read(resolved.scope, path);
    if (!entry) throw notFound();
    return c.json({
      scope: scopeResponse(resolved.scope),
      access: resolved.access,
      entry: {
        id: entry.id,
        path: entry.path,
        current_version: entry.currentVersion,
        content_sha256: entry.contentSha256,
        content: entry.content,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
      },
    });
  });

  app.post(`${BASE}/promotions/conversation-to-user`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const parsed = conversationToUserSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalidRequest();
    await requireConversationAccess(
      dependencies.database,
      access,
      parsed.data.conversation_id,
    );
    await requireAgentAccess(
      dependencies.database,
      access,
      parsed.data.agent_definition_id,
      false,
    );
    const entry = await dependencies.promotions.promoteConversationToAgentUser({
      tenantId: access.tenantId,
      agentDefinitionId: parsed.data.agent_definition_id,
      actor: principalRef({
        principalType: access.principalType,
        principalId: access.principalId,
      }),
      conversationId: parsed.data.conversation_id,
      sourcePath: parsed.data.source_path,
      targetPath: parsed.data.target_path,
    });
    return c.json({ entry: entryResponse(entry) }, 201);
  });

  app.post(`${BASE}/admissions/conversation-to-work`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const parsed = conversationToWorkSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalidRequest();
    await requireConversationAccess(
      dependencies.database,
      access,
      parsed.data.conversation_id,
    );
    await requireWorkAccess(dependencies.database, access, parsed.data.work_id);
    const entry = await dependencies.promotions.admitConversationToWork({
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      conversationId: parsed.data.conversation_id,
      workId: parsed.data.work_id,
      sourcePath: parsed.data.source_path,
      targetPath: parsed.data.target_path,
    });
    return c.json({ entry: entryResponse(entry) }, 201);
  });

  app.post(`${BASE}/publications/work-result`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const parsed = workResultSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalidRequest();
    await requireWorkAccess(dependencies.database, access, parsed.data.work_id);
    const entry = await dependencies.promotions.publishWorkResult({
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      workId: parsed.data.work_id,
      sourcePath: parsed.data.source_path,
      targetPath: parsed.data.target_path,
    });
    return c.json({ entry: entryResponse(entry) }, 201);
  });

  app.post(`${BASE}/pins/agent`, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const parsed = pinAgentSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalidRequest();
    await requireAgentAccess(
      dependencies.database,
      access,
      parsed.data.agent_definition_id,
      true,
    );
    const source = await resolveScope(dependencies.database, access, {
      kind: parsed.data.source.scope,
      ...(parsed.data.source.agent_definition_id
        ? { agentDefinitionId: parsed.data.source.agent_definition_id }
        : {}),
      ...(parsed.data.source.conversation_id
        ? { conversationId: parsed.data.source.conversation_id }
        : {}),
      ...(parsed.data.source.work_id
        ? { workId: parsed.data.source.work_id }
        : {}),
    });
    const entry = await dependencies.promotions.pinMemoryToAgent({
      tenantId: access.tenantId,
      agentDefinitionId: parsed.data.agent_definition_id,
      sourceScope: source.scope,
      sourcePath: parsed.data.source.path,
      targetPath: parsed.data.target_path,
    });
    return c.json({ entry: entryResponse(entry) }, 201);
  });
}

type Access = ReturnType<typeof getAuthenticatedAccessContext>;
type RequestedScope = {
  readonly kind: z.infer<typeof scopeKindSchema>;
  readonly agentDefinitionId?: string;
  readonly conversationId?: string;
  readonly workId?: string;
};

async function resolveScope(
  database: Queryable,
  access: Access,
  request: RequestedScope,
): Promise<{ readonly scope: ContextScope; readonly access: 'read_only' | 'read_write' }> {
  switch (request.kind) {
    case 'organization':
      return {
        scope: organizationContextScope(access.tenantId),
        access: 'read_only',
      };
    case 'workspace':
      return {
        scope: workspaceContextScope({
          tenantId: access.tenantId,
          workspaceId: access.workspaceId,
        }),
        access: 'read_write',
      };
    case 'agent': {
      const owned = await requireAgentAccess(
        database,
        access,
        required(request.agentDefinitionId, 'agent_definition_id'),
        false,
      );
      return {
        scope: agentContextScope({
          tenantId: access.tenantId,
          agentDefinitionId: required(request.agentDefinitionId, 'agent_definition_id'),
        }),
        access: owned ? 'read_write' : 'read_only',
      };
    }
    case 'agent_user':
      await requireAgentAccess(
        database,
        access,
        required(request.agentDefinitionId, 'agent_definition_id'),
        false,
      );
      return {
        scope: agentUserContextScope({
          tenantId: access.tenantId,
          agentDefinitionId: required(request.agentDefinitionId, 'agent_definition_id'),
          principal: principalRef({
            principalType: access.principalType,
            principalId: access.principalId,
          }),
        }),
        access: 'read_write',
      };
    case 'conversation': {
      const conversationId = required(request.conversationId, 'conversation_id');
      await requireConversationAccess(database, access, conversationId);
      return {
        scope: conversationContextScope({
          tenantId: access.tenantId,
          conversationId,
        }),
        access: 'read_write',
      };
    }
    case 'work': {
      const workId = required(request.workId, 'work_id');
      await requireWorkAccess(database, access, workId);
      return {
        scope: workContextScope({
          tenantId: access.tenantId,
          workspaceId: access.workspaceId,
          workId,
        }),
        access: 'read_write',
      };
    }
  }
}

async function requireConversationAccess(
  database: Queryable,
  access: Access,
  conversationId: string,
): Promise<void> {
  const result = await database.query<{ conversation_id: string }>(
    `SELECT conversation_id FROM conversation_members
      WHERE tenant_id=$1 AND conversation_id=$2 AND member_type='principal'
        AND member_id=$3 AND member_principal_type=$4`,
    [access.tenantId, conversationId, access.principalId, access.principalType],
  );
  if (!result.rows?.[0]) throw notFound();
}

async function requireWorkAccess(
  database: Queryable,
  access: Access,
  workId: string,
): Promise<void> {
  const result = await database.query<{ id: string }>(
    `SELECT id FROM works WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`,
    [workId, access.tenantId, access.workspaceId],
  );
  if (!result.rows?.[0]) throw notFound();
}

async function requireAgentAccess(
  database: Queryable,
  access: Access,
  agentDefinitionId: string,
  requireOwner: boolean,
): Promise<boolean> {
  const result = await database.query<{
    id: string;
    workspace_id: string;
    principal_type: string;
    principal_id: string;
  }>(
    `SELECT id,workspace_id,principal_type,principal_id
       FROM agent_definitions WHERE id=$1 AND tenant_id=$2`,
    [agentDefinitionId, access.tenantId],
  );
  const row = result.rows?.[0];
  if (!row) throw notFound();
  const owned =
    row.workspace_id === access.workspaceId &&
    row.principal_type === access.principalType &&
    row.principal_id === access.principalId;
  if (requireOwner && !owned)
    throw new HttpError(
      403,
      'agent_context_write_forbidden',
      'Only the Agent owner may modify shared Agent context.',
    );
  return owned;
}

function parseScopeRequest(params: URLSearchParams): RequestedScope {
  const kind = scopeKindSchema.safeParse(params.get('scope'));
  if (!kind.success) throw invalidRequest();
  return {
    kind: kind.data,
    ...(params.get('agent_definition_id')
      ? { agentDefinitionId: params.get('agent_definition_id')! }
      : {}),
    ...(params.get('conversation_id')
      ? { conversationId: params.get('conversation_id')! }
      : {}),
    ...(params.get('work_id') ? { workId: params.get('work_id')! } : {}),
  };
}

const commonPath = z.string().trim().min(1).max(2048);
const conversationToUserSchema = z
  .object({
    agent_definition_id: z.string().trim().min(1),
    conversation_id: z.string().uuid(),
    source_path: commonPath,
    target_path: commonPath,
  })
  .strict();
const conversationToWorkSchema = z
  .object({
    conversation_id: z.string().uuid(),
    work_id: z.string().uuid(),
    source_path: commonPath,
    target_path: commonPath,
  })
  .strict();
const workResultSchema = z
  .object({
    work_id: z.string().uuid(),
    source_path: commonPath,
    target_path: commonPath,
  })
  .strict();
const pinAgentSchema = z
  .object({
    agent_definition_id: z.string().trim().min(1),
    source: z
      .object({
        scope: scopeKindSchema.exclude(['organization']),
        agent_definition_id: z.string().optional(),
        conversation_id: z.string().uuid().optional(),
        work_id: z.string().uuid().optional(),
        path: commonPath,
      })
      .strict(),
    target_path: commonPath,
  })
  .strict();

function entryResponse(entry: {
  id: string;
  path: string;
  currentVersion: number;
  contentSha256: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: entry.id,
    path: entry.path,
    current_version: entry.currentVersion,
    content_sha256: entry.contentSha256,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function scopeResponse(scope: ContextScope) {
  return scope;
}
function requiredParam(params: URLSearchParams, key: string): string {
  return required(params.get(key) ?? undefined, key);
}
function required(value: string | undefined, key: string): string {
  if (!value) throw new HttpError(400, 'invalid_request', `${key} is required.`);
  return value;
}
function invalidRequest(): HttpError {
  return new HttpError(400, 'invalid_request', 'The context request is invalid.');
}
function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'The requested context resource does not exist.');
}
