import { randomUUID } from 'node:crypto';
import type { AccessContext } from '../control-plane/access-context.js';
import type {
  MemoryApiRepository,
  CreateMemoryInput,
  UpdateMemoryInput,
} from '../ports/memory-api-repository.js';
import { MemoryPreconditionFailedError } from '../ports/memory-api-repository.js';
import {
  contentSizeBytes,
  normalizeMemoryPath,
  sha256,
  validateMemoryContent,
  type Memory,
  type MemoryApiPrincipalScope,
  type MemoryStore,
} from '../../domain/memory-api/memory-api.js';

function principal(access: AccessContext): MemoryApiPrincipalScope {
  return {
    tenantId: access.tenantId,
    principalType: access.principalType,
    principalId: access.principalId,
  };
}
function now(): string {
  return new Date().toISOString();
}

export class CreateMemoryStore {
  public constructor(private readonly repository: MemoryApiRepository) {}
  public execute(input: {
    accessContext: AccessContext;
    workspaceId: string;
    name: string;
    description?: string;
  }): Promise<MemoryStore | null> {
    return this.repository.createStore({
      id: randomUUID(),
      principal: principal(input.accessContext),
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
    });
  }
}
export class ListMemoryStores {
  public constructor(private readonly repository: MemoryApiRepository) {}
  public execute(input: {
    accessContext: AccessContext;
    workspaceId: string;
  }): Promise<readonly MemoryStore[] | null> {
    return this.repository.listStores(
      principal(input.accessContext),
      input.workspaceId,
    );
  }
}
export class GetMemoryStore {
  public constructor(private readonly repository: MemoryApiRepository) {}
  public execute(
    id: string,
    access: AccessContext,
  ): Promise<MemoryStore | null> {
    return this.repository.getStore(id, principal(access));
  }
}
export class CreateMemory {
  public constructor(private readonly repository: MemoryApiRepository) {}
  public execute(input: {
    accessContext: AccessContext;
    storeId: string;
    path: string;
    content: string;
  }): Promise<Memory | null> {
    const content = validateMemoryContent(input.content);
    const data: CreateMemoryInput = {
      id: randomUUID(),
      versionId: randomUUID(),
      storeId: input.storeId,
      path: normalizeMemoryPath(input.path),
      content,
      now: now(),
    };
    return this.repository.createMemory(data, principal(input.accessContext));
  }
}
export class ListMemories {
  public constructor(private readonly repository: MemoryApiRepository) {}
  public execute(
    storeId: string,
    access: AccessContext,
  ): Promise<readonly Memory[] | null> {
    return this.repository.listMemories(storeId, principal(access));
  }
}
export class GetMemory {
  public constructor(private readonly repository: MemoryApiRepository) {}
  public execute(
    storeId: string,
    memoryId: string,
    access: AccessContext,
  ): Promise<Memory | null> {
    return this.repository.getMemory(storeId, memoryId, principal(access));
  }
}
export class UpdateMemory {
  public constructor(private readonly repository: MemoryApiRepository) {}
  public async execute(input: {
    accessContext: AccessContext;
    storeId: string;
    memoryId: string;
    content: string;
    expectedSha256: string;
  }): Promise<Memory | null> {
    const content = validateMemoryContent(input.content);
    const data: UpdateMemoryInput = {
      memoryId: input.memoryId,
      storeId: input.storeId,
      principal: principal(input.accessContext),
      content,
      expectedSha256: input.expectedSha256,
      versionId: randomUUID(),
      now: now(),
    };
    return this.repository.updateMemory(data);
  }
}
export {
  InvalidMemoryContentError,
  InvalidMemoryPathError,
  MemoryPathConflictError,
} from '../../domain/memory-api/memory-api.js';
export { MemoryPreconditionFailedError, contentSizeBytes, sha256 };
