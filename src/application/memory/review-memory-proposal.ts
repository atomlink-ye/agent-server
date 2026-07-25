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
  readonly controller?: {
    readonly kind: 'channel_ingress';
    readonly ingressId: string;
  };
}

export interface ReviewMemoryProposalResult {
  readonly proposal: MemoryProposal;
  readonly entry: WorkspaceMemoryEntry | null;
  readonly replayed?: boolean;
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
    if (input.controller) {
      const result = await this.memoryRepository.reviewProposal({
        proposalId: input.proposalId,
        ownerScope,
        outcome: input.action,
        reviewedContent: input.content ?? null,
        reviewerSnapshot: {
          principalType: input.accessContext.principalType,
          principalId: input.accessContext.principalId,
          policySnapshotVersion: input.accessContext.policySnapshotVersion,
        },
        controller: input.controller,
        ...(input.now ? { now: input.now } : {}),
      });
      return result;
    }
    const existing = this.memoryRepository.findProposalByIdForActor
      ? await this.memoryRepository.findProposalByIdForActor(input.proposalId, {
          tenantId: input.accessContext.tenantId,
          principalType: input.accessContext.principalType,
          principalId: input.accessContext.principalId,
        })
      : await this.memoryRepository.findProposalByIdForOwner(
          input.proposalId,
          ownerScope,
        );
    if (!existing) {
      throw new MemoryProposalNotFoundError();
    }
    if (existing.status !== 'pending') {
      const sameDecision =
        existing.status === 'accepted' &&
        existing.reviewOutcome === input.action &&
        (input.action === 'edit_and_accept'
          ? existing.reviewedContent === (input.content ?? null)
          : input.content == null);
      const entry =
        sameDecision &&
        this.memoryRepository.findAcceptedEntryByProposalForOwner
          ? await this.memoryRepository.findAcceptedEntryByProposalForOwner(
              existing.id,
              {
                tenantId: existing.tenantId,
                workspaceId: existing.workspaceId,
                principalType: existing.principalType,
                principalId: existing.principalId,
              },
            )
          : null;
      if (sameDecision && entry) return { proposal: existing, entry };
      throw new MemoryProposalAlreadyReviewedError();
    }

    try {
      return await this.memoryRepository.reviewProposal({
        proposalId: input.proposalId,
        ownerScope: {
          tenantId: existing.tenantId,
          workspaceId: existing.workspaceId,
          principalType: existing.principalType,
          principalId: existing.principalId,
        },
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

  public async findForAccess(
    proposalId: string,
    accessContext: ServiceAccountAccessContext,
  ): Promise<MemoryProposal | null> {
    return this.memoryRepository.findProposalByIdForActor
      ? this.memoryRepository.findProposalByIdForActor(proposalId, {
          tenantId: accessContext.tenantId,
          principalType: accessContext.principalType,
          principalId: accessContext.principalId,
        })
      : this.memoryRepository.findProposalByIdForOwner(
          proposalId,
          ownerScopeFromAccessContext(accessContext),
        );
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
