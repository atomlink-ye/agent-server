import type {
  MemoryApiPrincipalScope,
  Memory,
} from '../../domain/memory-api/memory-api.js';
import type { LearningProposal } from '../../domain/learning/learning-proposal.js';

export interface LearningProposalOwnerScope extends MemoryApiPrincipalScope {
  readonly workspaceId: string;
}
export interface CreateLearningProposalInput extends LearningProposal {
  readonly owner: LearningProposalOwnerScope;
}
export interface ReviewLearningProposalInput {
  readonly proposalId: string;
  readonly owner: LearningProposalOwnerScope;
  readonly editedContent?: string;
  readonly versionId: string;
  readonly now: string;
}
export interface LearningProposalRepository {
  createProposal(
    proposal: CreateLearningProposalInput,
  ): Promise<LearningProposal | null>;
  listProposals(
    owner: LearningProposalOwnerScope,
  ): Promise<readonly LearningProposal[]>;
  getProposal(
    id: string,
    owner: LearningProposalOwnerScope,
  ): Promise<LearningProposal | null>;
  acceptProposal(
    input: ReviewLearningProposalInput,
  ): Promise<{ proposal: LearningProposal; memory: Memory }>;
  rejectProposal(input: {
    proposalId: string;
    owner: LearningProposalOwnerScope;
    now: string;
  }): Promise<LearningProposal>;
}
export class LearningProposalNotFoundError extends Error {
  public readonly code = 'learning_proposal_not_found';
}
export class LearningProposalNotPendingError extends Error {
  public readonly code = 'learning_proposal_not_pending';
}
