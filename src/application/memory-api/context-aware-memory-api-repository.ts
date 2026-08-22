import type {
  CreateMemoryInput,
  CreateMemoryStoreInput,
  MemoryApiRepository,
  UpdateMemoryInput,
} from '../ports/memory-api-repository.js';
import type {
  Memory,
  MemoryApiPrincipalScope,
  MemoryStore,
} from '../../domain/memory-api/memory-api.js';
import { workspaceContextScope } from '../../domain/context/context-fs.js';
import { ContextMemoryService } from '../context/context-memory-service.js';

/**
 * Compatibility facade: the legacy Memory API remains stable, while every new
 * create/update is mirrored into canonical ContextFS with explicit workspace
 * provenance. Reads never migrate historical rows implicitly.
 */
export class ContextAwareMemoryApiRepository implements MemoryApiRepository {
  public constructor(
    private readonly legacy: MemoryApiRepository,
    private readonly canonical: ContextMemoryService,
  ) {}

  public createStore(input: CreateMemoryStoreInput): Promise<MemoryStore | null> {
    return this.legacy.createStore(input);
  }

  public listStores(
    principal: MemoryApiPrincipalScope,
    workspaceId: string,
  ): Promise<readonly MemoryStore[] | null> {
    return this.legacy.listStores(principal, workspaceId);
  }

  public getStore(
    id: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<MemoryStore | null> {
    return this.legacy.getStore(id, principal);
  }

  public async createMemory(
    input: CreateMemoryInput,
    principal: MemoryApiPrincipalScope,
  ): Promise<Memory | null> {
    const memory = await this.legacy.createMemory(input, principal);
    if (!memory) return null;
    const store = await this.legacy.getStore(input.storeId, principal);
    if (!store) throw new Error('Created Memory store disappeared before ContextFS projection.');
    await this.canonical.write({
      memoryId: memory.id,
      scope: workspaceContextScope({
        tenantId: store.owner.tenantId,
        workspaceId: store.owner.workspaceId,
      }),
      path: memory.path,
      content: memory.current.content,
      source: { kind: 'memory_api', sourceId: store.id },
      now: memory.updatedAt,
    });
    return memory;
  }

  public listMemories(
    storeId: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<readonly Memory[] | null> {
    return this.legacy.listMemories(storeId, principal);
  }

  public getMemory(
    storeId: string,
    memoryId: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<Memory | null> {
    return this.legacy.getMemory(storeId, memoryId, principal);
  }

  public async updateMemory(input: UpdateMemoryInput): Promise<Memory | null> {
    const memory = await this.legacy.updateMemory(input);
    if (!memory) return null;
    const store = await this.legacy.getStore(input.storeId, input.principal);
    if (!store) throw new Error('Updated Memory store disappeared before ContextFS projection.');
    // Updating an old row is the deliberate migration event. Mere reads never
    // invent a scope for historical data.
    await this.canonical.write({
      memoryId: memory.id,
      scope: workspaceContextScope({
        tenantId: store.owner.tenantId,
        workspaceId: store.owner.workspaceId,
      }),
      path: memory.path,
      content: memory.current.content,
      source: { kind: 'memory_api', sourceId: store.id },
      now: memory.updatedAt,
    });
    return memory;
  }
}
