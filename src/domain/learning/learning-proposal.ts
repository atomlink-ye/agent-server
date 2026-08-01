import {
  contentSizeBytes,
  normalizeMemoryPath,
  sha256,
  validateMemoryContent,
} from '../memory-api/memory-api.js';

export const MAX_LEARNING_PROPOSAL_CONTENT_BYTES = 8192;
export const MAX_LEARNING_PROPOSAL_EVIDENCE_REFS = 8;

export type LearningProposalStatus = 'pending' | 'accepted' | 'rejected';
export interface LearningProposalOwner {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}
export interface LearningProposal {
  readonly id: string;
  readonly owner: LearningProposalOwner;
  readonly sourceTeamRunId: string;
  readonly sourceTaskId: string;
  readonly sourceRunId: string;
  readonly targetMemoryStoreId: string;
  readonly targetMemoryId: string;
  readonly targetPath: string;
  readonly baseContentSha256: string;
  readonly proposedContent: string;
  readonly evidenceRefs: readonly string[];
  readonly status: LearningProposalStatus;
  readonly acceptedMemoryVersionId: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createLearningProposal(
  input: Omit<
    LearningProposal,
    'status' | 'acceptedMemoryVersionId' | 'reviewedAt'
  >,
): LearningProposal {
  const proposedContent = validateProposalContent(input.proposedContent);
  const targetPath = normalizeMemoryPath(input.targetPath);
  if (!/^[0-9a-f]{64}$/.test(input.baseContentSha256))
    throw new Error('invalid learning proposal base SHA');
  if (
    input.evidenceRefs.length < 1 ||
    input.evidenceRefs.length > MAX_LEARNING_PROPOSAL_EVIDENCE_REFS ||
    input.evidenceRefs.some(
      (ref) => ref.trim().length === 0 || ref.length > 512,
    )
  )
    throw new Error('invalid learning proposal evidence refs');
  return {
    ...input,
    targetPath,
    proposedContent,
    status: 'pending',
    acceptedMemoryVersionId: null,
    reviewedAt: null,
  };
}

export function validateProposalContent(content: string): string {
  const normalized = validateMemoryContent(content);
  if (contentSizeBytes(normalized) > MAX_LEARNING_PROPOSAL_CONTENT_BYTES)
    throw new Error('learning proposal content exceeds 8192 bytes');
  return normalized;
}

export function proposalContentSha256(content: string): string {
  return sha256(content);
}
