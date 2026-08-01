import { randomUUID } from 'node:crypto';
import type { AccessContext } from '../control-plane/access-context.js';
import type { LearningProposal } from '../../domain/learning/learning-proposal.js';
import {
  MAX_LEARNING_PROPOSAL_EVIDENCE_REFS,
  validateProposalContent,
} from '../../domain/learning/learning-proposal.js';
import { normalizeMemoryPath } from '../../domain/memory-api/memory-api.js';
import type {
  LearningProposalOwnerScope,
  LearningProposalRepository,
} from '../ports/learning-proposal-repository.js';

function owner(access: AccessContext): LearningProposalOwnerScope {
  return {
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    principalType: access.principalType,
    principalId: access.principalId,
  };
}
export class CreateLearningProposal {
  public constructor(private readonly repository: LearningProposalRepository) {}
  public execute(
    input: Omit<
      LearningProposal,
      | 'id'
      | 'status'
      | 'acceptedMemoryVersionId'
      | 'reviewedAt'
      | 'createdAt'
      | 'updatedAt'
      | 'owner'
    > & { accessContext: AccessContext },
  ): Promise<LearningProposal | null> {
    const now = new Date().toISOString();
    return this.repository.createProposal({
      id: randomUUID(),
      owner: owner(input.accessContext),
      sourceTeamRunId: input.sourceTeamRunId,
      sourceTaskId: input.sourceTaskId,
      sourceRunId: input.sourceRunId,
      targetMemoryStoreId: input.targetMemoryStoreId,
      targetMemoryId: input.targetMemoryId,
      targetPath: normalizeMemoryPath(input.targetPath),
      baseContentSha256: input.baseContentSha256,
      proposedContent: validateProposalContent(input.proposedContent),
      evidenceRefs: validateEvidenceRefs(input.evidenceRefs),
      status: 'pending',
      acceptedMemoryVersionId: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function validateEvidenceRefs(refs: readonly string[]): readonly string[] {
  if (
    refs.length < 1 ||
    refs.length > MAX_LEARNING_PROPOSAL_EVIDENCE_REFS ||
    refs.some((ref) => ref.trim().length === 0 || ref.length > 512)
  )
    throw new Error('invalid learning proposal evidence refs');
  return refs;
}
export class ListLearningProposals {
  public constructor(private readonly repository: LearningProposalRepository) {}
  public execute(access: AccessContext) {
    return this.repository.listProposals(owner(access));
  }
}
export class GetLearningProposal {
  public constructor(private readonly repository: LearningProposalRepository) {}
  public execute(id: string, access: AccessContext) {
    return this.repository.getProposal(id, owner(access));
  }
}
export class AcceptLearningProposal {
  public constructor(private readonly repository: LearningProposalRepository) {}
  public execute(input: {
    proposalId: string;
    accessContext: AccessContext;
    editedContent?: string;
  }) {
    return this.repository.acceptProposal({
      proposalId: input.proposalId,
      owner: owner(input.accessContext),
      ...(input.editedContent === undefined
        ? {}
        : { editedContent: validateProposalContent(input.editedContent) }),
      versionId: randomUUID(),
      now: new Date().toISOString(),
    });
  }
}
export class RejectLearningProposal {
  public constructor(private readonly repository: LearningProposalRepository) {}
  public execute(input: { proposalId: string; accessContext: AccessContext }) {
    return this.repository.rejectProposal({
      proposalId: input.proposalId,
      owner: owner(input.accessContext),
      now: new Date().toISOString(),
    });
  }
}
