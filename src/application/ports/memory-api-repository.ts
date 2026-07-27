import type {
  Memory,
  MemoryApiPrincipalScope,
  MemoryStore,
} from '../../domain/memory-api/memory-api.js';

export interface CreateMemoryStoreInput {
  readonly id: string;
  readonly principal: MemoryApiPrincipalScope;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
}
export interface CreateMemoryInput {
  readonly id: string;
  readonly versionId: string;
  readonly storeId: string;
  readonly path: string;
  readonly content: string;
  readonly now: string;
}
export interface UpdateMemoryInput {
  readonly memoryId: string;
  readonly storeId: string;
  readonly principal: MemoryApiPrincipalScope;
  readonly content: string;
  readonly expectedSha256: string;
  readonly versionId: string;
  readonly now: string;
}
export interface MemoryApiRepository {
  createStore(input: CreateMemoryStoreInput): Promise<MemoryStore | null>;
  listStores(
    principal: MemoryApiPrincipalScope,
    workspaceId: string,
  ): Promise<readonly MemoryStore[] | null>;
  getStore(
    id: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<MemoryStore | null>;
  createMemory(
    input: CreateMemoryInput,
    principal: MemoryApiPrincipalScope,
  ): Promise<Memory | null>;
  listMemories(
    storeId: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<readonly Memory[] | null>;
  getMemory(
    storeId: string,
    memoryId: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<Memory | null>;
  updateMemory(input: UpdateMemoryInput): Promise<Memory | null>;
}

export class MemoryPreconditionFailedError extends Error {
  public readonly code = 'memory_precondition_failed';
  public constructor() {
    super('The memory content has changed.');
  }
}
