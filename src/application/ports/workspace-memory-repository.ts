import type {
  AcceptedMemoryReviewOutcome,
  MemoryProposal,
  MemoryReviewOutcome,
  WorkspaceMemoryActorSnapshot,
  WorkspaceMemoryEntry,
  WorkspaceMemoryOwnerScope,
} from '../../domain/workspace-memory/memory-proposal.js';

export type WorkspaceMemoryRepositoryOwnerScope = WorkspaceMemoryOwnerScope;
export type WorkspaceMemoryRepositoryActorScope = Pick<
  WorkspaceMemoryOwnerScope,
  'tenantId' | 'principalType' | 'principalId'
>;

export interface ReviewMemoryProposalRepositoryInput {
  readonly proposalId: string;
  readonly ownerScope: WorkspaceMemoryRepositoryOwnerScope;
  readonly outcome: MemoryReviewOutcome;
  readonly reviewedContent?: string | null;
  readonly reviewerSnapshot: WorkspaceMemoryActorSnapshot;
  readonly now?: () => Date;
  readonly entryIdFactory?: () => string;
}

export interface ReviewMemoryProposalRepositoryResult {
  readonly proposal: MemoryProposal;
  readonly entry: WorkspaceMemoryEntry | null;
}

export interface WorkspaceMemoryRepository {
  createProposal(proposal: MemoryProposal): Promise<MemoryProposal>;
  findProposalByIdForOwner(
    proposalId: string,
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<MemoryProposal | null>;
  findProposalByIdForActor?(
    proposalId: string,
    actorScope: WorkspaceMemoryRepositoryActorScope,
  ): Promise<MemoryProposal | null>;
  listProposalsByOwnerScope(
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<readonly MemoryProposal[]>;
  reviewProposal(
    input: ReviewMemoryProposalRepositoryInput,
  ): Promise<ReviewMemoryProposalRepositoryResult>;
  listAcceptedEntriesByOwnerScope(
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<readonly WorkspaceMemoryEntry[]>;
}

export type { AcceptedMemoryReviewOutcome };
