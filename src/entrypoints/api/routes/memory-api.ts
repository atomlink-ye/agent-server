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
  CreateMemoryStore,
  ListMemoryStores,
  GetMemoryStore,
  CreateMemory,
  ListMemories,
  GetMemory,
  UpdateMemory,
  InvalidMemoryContentError,
  InvalidMemoryPathError,
  MemoryPathConflictError,
  MemoryPreconditionFailedError,
} from '../../../application/memory-api/memory-api.js';
import {
  CreateMemoryStoreRequestSchema,
  CreateMemoryRequestSchema,
  UpdateMemoryRequestSchema,
  MAX_MEMORY_API_REQUEST_BYTES,
} from '../../../contracts/memory-api.js';
import type {
  Memory,
  MemoryStore,
} from '../../../domain/memory-api/memory-api.js';

export interface MemoryApiRouteDependencies {
  readonly config: AppConfig;
  readonly createMemoryStore: CreateMemoryStore;
  readonly listMemoryStores: ListMemoryStores;
  readonly getMemoryStore: GetMemoryStore;
  readonly createMemory: CreateMemory;
  readonly listMemories: ListMemories;
  readonly getMemory: GetMemory;
  readonly updateMemory: UpdateMemory;
}
const base = '/api/v1/memory-stores';

export function registerMemoryApiRoutes(
  app: Hono<ApiEnvironment>,
  d: MemoryApiRouteDependencies,
): void {
  const auth = new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []);
  app.use(`${base}/*`, requireServiceAccountAccess(auth));
  app.use(base, requireServiceAccountAccess(auth));
  app.post(base, async (c) => {
    const parsed = CreateMemoryStoreRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_MEMORY_API_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalid();
    const access = getAuthenticatedAccessContext(c);
    const store = await d.createMemoryStore.execute({
      accessContext: access,
      workspaceId: parsed.data.workspace_id,
      name: parsed.data.name,
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
    });
    if (!store) throw notFound();
    return c.json({ memory_store: toStore(store) }, 201);
  });
  app.get(base, async (c) => {
    const workspaceId = z.uuid().safeParse(c.req.query('workspace_id'));
    if (!workspaceId.success) throw invalid();
    const access = getAuthenticatedAccessContext(c);
    const stores = await d.listMemoryStores.execute({
      accessContext: access,
      workspaceId: workspaceId.data,
    });
    if (!stores) throw notFound();
    return c.json({ memory_stores: stores.map(toStore) }, 200);
  });
  app.get(`${base}/:storeId`, async (c) => {
    const storeId = validUuid(c.req.param('storeId'), 'memory_store_id');
    const store = await d.getMemoryStore.execute(
      storeId,
      getAuthenticatedAccessContext(c),
    );
    if (!store) throw notFound();
    return c.json({ memory_store: toStore(store) }, 200);
  });
  app.post(`${base}/:storeId/memories`, async (c) => {
    const storeId = validUuid(c.req.param('storeId'), 'memory_store_id');
    const parsed = CreateMemoryRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_MEMORY_API_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalid();
    try {
      const memory = await d.createMemory.execute({
        accessContext: getAuthenticatedAccessContext(c),
        storeId,
        path: parsed.data.path,
        content: parsed.data.content,
      });
      if (!memory) throw notFound();
      return c.json({ memory: toMemory(memory) }, 201);
    } catch (e) {
      if (
        e instanceof InvalidMemoryPathError ||
        e instanceof InvalidMemoryContentError
      )
        throw invalid();
      if (e instanceof MemoryPathConflictError)
        throw new HttpError(409, e.code, e.message);
      throw e;
    }
  });
  app.get(`${base}/:storeId/memories`, async (c) => {
    const storeId = validUuid(c.req.param('storeId'), 'memory_store_id');
    const memories = await d.listMemories.execute(
      storeId,
      getAuthenticatedAccessContext(c),
    );
    if (!memories) throw notFound();
    return c.json({ memories: memories.map(toMemory) }, 200);
  });
  app.get(`${base}/:storeId/memories/:memoryId`, async (c) => {
    const storeId = validUuid(c.req.param('storeId'), 'memory_store_id');
    const memoryId = validUuid(c.req.param('memoryId'), 'memory_id');
    const memory = await d.getMemory.execute(
      storeId,
      memoryId,
      getAuthenticatedAccessContext(c),
    );
    if (!memory) throw notFound();
    return c.json({ memory: toMemory(memory) }, 200);
  });
  app.post(`${base}/:storeId/memories/:memoryId`, async (c) => {
    const storeId = validUuid(c.req.param('storeId'), 'memory_store_id');
    const memoryId = validUuid(c.req.param('memoryId'), 'memory_id');
    const parsed = UpdateMemoryRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_MEMORY_API_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalid();
    try {
      const memory = await d.updateMemory.execute({
        accessContext: getAuthenticatedAccessContext(c),
        storeId,
        memoryId,
        content: parsed.data.content,
        expectedSha256: parsed.data.precondition.content_sha256,
      });
      if (!memory) throw notFound();
      return c.json({ memory: toMemory(memory) }, 200);
    } catch (e) {
      if (e instanceof MemoryPreconditionFailedError)
        throw new HttpError(409, e.code, e.message);
      if (e instanceof InvalidMemoryContentError) throw invalid();
      throw e;
    }
  });
}
function validUuid(value: string, name: string): string {
  if (!z.uuid().safeParse(value).success)
    throw new HttpError(
      400,
      'invalid_request',
      `${name} must be a valid UUID.`,
    );
  return value;
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
function toStore(s: MemoryStore) {
  return {
    memory_store_id: s.id,
    workspace_id: s.owner.workspaceId,
    name: s.name,
    description: s.description,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}
function toMemory(m: Memory) {
  return {
    memory_id: m.id,
    memory_store_id: m.storeId,
    path: m.path,
    memory_version_id: m.current.id,
    version: m.current.version,
    content_sha256: m.current.contentSha256,
    content_size_bytes: m.current.contentSizeBytes,
    content: m.current.content,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}
