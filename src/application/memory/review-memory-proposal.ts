import type { ServiceAccountAccessContext } from '../control-plane/access-context.js';
import type { WorkspaceMemoryRepository } from '../ports/workspace-memory-repository.js';
import {
  NonPendingMemoryProposalReviewError,
  type MemoryProposal,
  type MemoryReviewOutcome,
  type WorkspaceMemoryEntry,
} from '../../domain/workspace-memory/memory-proposal.js';

export interface ReviewMemoryProposalInput {
  readonly proposalId: string;
  readonly action: MemoryReviewOutcome;
  readonly content?: string | null;
  readonly accessContext: ServiceAccountAccessContext;
  readonly now?: () => Date;
}

export interface ReviewMemoryProposalResult {
  readonly proposal: MemoryProposal;
  readonly entry: WorkspaceMemoryEntry | null;
}

export class MemoryProposalNotFoundError extends Error {
  public readonly code = 'memory_proposal_not_found';

  public constructor() {
    super('The requested memory proposal does not exist.');
    this.name = 'MemoryProposalNotFoundError';
  }
}

export class MemoryProposalAlreadyReviewedError extends Error {
  public readonly code = 'memory_proposal_already_reviewed';

  public constructor() {
    super('The requested memory proposal has already been reviewed.');
    this.name = 'MemoryProposalAlreadyReviewedError';
  }
}

export class ReviewMemoryProposal {
  public constructor(
    private readonly memoryRepository: WorkspaceMemoryRepository,
  ) {}

  public async execute(
    input: ReviewMemoryProposalInput,
  ): Promise<ReviewMemoryProposalResult> {
    const ownerScope = ownerScopeFromAccessContext(input.accessContext);
    const existing = await this.memoryRepository.findProposalByIdForOwner(
      input.proposalId,
      ownerScope,
    );
    if (!existing) {
      throw new MemoryProposalNotFoundError();
    }
    if (existing.status !== 'pending') {
      throw new MemoryProposalAlreadyReviewedError();
    }

    try {
      return await this.memoryRepository.reviewProposal({
        proposalId: input.proposalId,
        ownerScope,
        outcome: input.action,
        reviewedContent: input.content ?? null,
        reviewerSnapshot: {
          principalType: input.accessContext.principalType,
          principalId: input.accessContext.principalId,
          policySnapshotVersion: input.accessContext.policySnapshotVersion,
        },
        ...(input.now ? { now: input.now } : {}),
      });
    } catch (error) {
      if (error instanceof NonPendingMemoryProposalReviewError) {
        throw new MemoryProposalAlreadyReviewedError();
      }
      throw error;
    }
  }
}

function ownerScopeFromAccessContext(
  accessContext: ServiceAccountAccessContext,
) {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}
