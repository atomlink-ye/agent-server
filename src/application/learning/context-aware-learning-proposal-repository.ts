import type {
  CreateLearningProposalInput,
  LearningProposalOwnerScope,
  LearningProposalRepository,
  ReviewLearningProposalInput,
} from '../ports/learning-proposal-repository.js';
import type { LearningProposal } from '../../domain/learning/learning-proposal.js';
import { workspaceContextScope } from '../../domain/context/context-fs.js';
import { ContextMemoryService } from '../context/context-memory-service.js';

/** Stable Learning Proposal contract with canonical Memory convergence on accept. */
export class ContextAwareLearningProposalRepository implements LearningProposalRepository {
  public constructor(
    private readonly legacy: LearningProposalRepository,
    private readonly canonical: ContextMemoryService,
  ) {}

  public createProposal(input: CreateLearningProposalInput) {
    return this.legacy.createProposal(input);
  }
  public listProposals(owner: LearningProposalOwnerScope) {
    return this.legacy.listProposals(owner);
  }
  public getProposal(id: string, owner: LearningProposalOwnerScope) {
    return this.legacy.getProposal(id, owner);
  }
  public rejectProposal(input: {
    proposalId: string;
    owner: LearningProposalOwnerScope;
    now: string;
  }): Promise<LearningProposal> {
    return this.legacy.rejectProposal(input);
  }

  public async acceptProposal(input: ReviewLearningProposalInput) {
    const result = await this.legacy.acceptProposal(input);
    await this.canonical.write({
      memoryId: result.memory.id,
      scope: workspaceContextScope({
        tenantId: input.owner.tenantId,
        workspaceId: input.owner.workspaceId,
      }),
      path: result.memory.path,
      content: result.memory.current.content,
      source: { kind: 'learning_proposal', sourceId: result.proposal.id },
      now: input.now,
    });
    return result;
  }
}
