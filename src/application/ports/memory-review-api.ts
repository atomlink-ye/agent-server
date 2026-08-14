import type { ListMemoryEntries } from '../memory/list-memory-entries.js';
import type { ListMemoryProposals } from '../memory/list-memory-proposals.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import type { ReviewMemoryProposal } from '../memory/review-memory-proposal.js';
import type { ManagedMemory } from '../memory/managed-memory.js';
import type { WorkspaceMemoryRepository } from './workspace-memory-repository.js';

export type MemoryReviewApi = {
  readonly review: Pick<ReviewMemoryProposal, 'execute' | 'findForAccess'>;
  readonly managedMemory: Pick<ManagedMemory, 'acceptEntry'>;
  readonly workspaceMemory: {
    readonly listPendingProposalsBySourceRunForOwner: NonNullable<
      WorkspaceMemoryRepository['listPendingProposalsBySourceRunForOwner']
    >;
  };
};

export type MemoryWorkspaceHttpApi = {
  readonly createMemoryProposal: Pick<CreateMemoryProposal, 'execute'>;
  readonly listMemoryProposals: Pick<ListMemoryProposals, 'execute'>;
  readonly reviewMemoryProposal: MemoryReviewApi['review'];
  readonly listMemoryEntries: Pick<ListMemoryEntries, 'execute'>;
  readonly managedMemory: Pick<
    ManagedMemory,
    'acceptEntry' | 'listEntries' | 'listSnapshots' | 'getSnapshot' | 'rebuild'
  >;
};
