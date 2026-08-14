import type { ServiceAccountAccessContext } from '../../platform/access-context.js';
import type { WorkspaceMemoryRepository } from '../ports/workspace-memory-repository.js';
import type { WorkspaceMemoryEntry } from '../../domain/workspace-memory/memory-proposal.js';

export class ListMemoryEntries {
  public constructor(
    private readonly memoryRepository: WorkspaceMemoryRepository,
  ) {}

  public async execute(
    accessContext: ServiceAccountAccessContext,
  ): Promise<readonly WorkspaceMemoryEntry[]> {
    return this.memoryRepository.listAcceptedEntriesByOwnerScope({
      tenantId: accessContext.tenantId,
      workspaceId: accessContext.workspaceId,
      principalType: accessContext.principalType,
      principalId: accessContext.principalId,
    });
  }
}
