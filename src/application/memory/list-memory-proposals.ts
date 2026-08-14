import type { ServiceAccountAccessContext } from '../../platform/access-context.js';
import type { WorkspaceMemoryRepository } from '../ports/workspace-memory-repository.js';
import type { MemoryProposal } from '../../domain/workspace-memory/memory-proposal.js';

export class ListMemoryProposals {
  public constructor(
    private readonly memoryRepository: WorkspaceMemoryRepository,
  ) {}

  public async execute(
    accessContext: ServiceAccountAccessContext,
  ): Promise<readonly MemoryProposal[]> {
    return this.memoryRepository.listProposalsByOwnerScope({
      tenantId: accessContext.tenantId,
      workspaceId: accessContext.workspaceId,
      principalType: accessContext.principalType,
      principalId: accessContext.principalId,
    });
  }
}
