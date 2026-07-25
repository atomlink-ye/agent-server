import { describe, expect, it } from 'vitest';

import type { ServiceAccountAccessContext } from '../control-plane/access-context.js';
import type {
  ReviewMemoryProposalRepositoryInput,
  WorkspaceMemoryRepository,
} from '../ports/workspace-memory-repository.js';
import {
  createMemoryProposal,
  createWorkspaceMemoryEntryFromAcceptedProposal,
  reviewMemoryProposal as reviewProposalDomain,
  type MemoryProposal,
  type WorkspaceMemoryEntry,
} from '../../domain/workspace-memory/memory-proposal.js';
import {
  MemoryProposalAlreadyReviewedError,
  MemoryProposalNotFoundError,
  ReviewMemoryProposal,
} from './review-memory-proposal.js';

const accessContext: ServiceAccountAccessContext = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account',
  principalId: 'svc_enabled',
  serviceAccountId: 'svc_enabled',
  policySnapshotVersion: 'policy-2026-07-22',
};

describe('ReviewMemoryProposal', () => {
  it('accepts a pending owner-scoped proposal and creates an entry through the repository', async () => {
    const proposal = makeProposal('proposal-1');
    const repository = new FakeWorkspaceMemoryRepository([proposal]);
    const service = new ReviewMemoryProposal(repository);

    const result = await service.execute({
      proposalId: proposal.id,
      action: 'edit_and_accept',
      content: 'Edited content.',
      accessContext,
      now: () => new Date('2026-07-23T01:00:00.000Z'),
    });

    expect(repository.lastReviewInput).toMatchObject({
      proposalId: proposal.id,
      outcome: 'edit_and_accept',
      reviewedContent: 'Edited content.',
      reviewerSnapshot: {
        principalType: 'service_account',
        principalId: 'svc_enabled',
        policySnapshotVersion: 'policy-2026-07-22',
      },
    });
    expect(result.proposal).toMatchObject({
      id: proposal.id,
      status: 'accepted',
      reviewOutcome: 'edit_and_accept',
      reviewedContent: 'Edited content.',
    });
    expect(result.entry).toMatchObject({
      proposalId: proposal.id,
      content: 'Edited content.',
      reviewOutcome: 'edit_and_accept',
    });
  });

  it('maps missing and non-pending proposals to application errors', async () => {
    const reviewed = reviewProposalDomain(makeProposal('proposal-reviewed'), {
      outcome: 'reject',
      reviewerSnapshot: {
        principalType: 'service_account',
        principalId: 'svc_enabled',
        policySnapshotVersion: 'policy-2026-07-22',
      },
    });
    const repository = new FakeWorkspaceMemoryRepository([reviewed]);
    const service = new ReviewMemoryProposal(repository);

    await expect(
      service.execute({
        proposalId: 'missing',
        action: 'accept',
        accessContext,
      }),
    ).rejects.toBeInstanceOf(MemoryProposalNotFoundError);

    await expect(
      service.execute({
        proposalId: reviewed.id,
        action: 'accept',
        accessContext,
      }),
    ).rejects.toBeInstanceOf(MemoryProposalAlreadyReviewedError);
  });

  it('passes a channel controller into the repository transaction for keyed replay', async () => {
    const proposal = makeProposal('proposal-controller');
    const repository = new FakeWorkspaceMemoryRepository([proposal]);
    await new ReviewMemoryProposal(repository).execute({
      proposalId: proposal.id,
      action: 'reject',
      accessContext,
      controller: { kind: 'channel_ingress', ingressId: 'ingress-1' },
    });
    expect(repository.lastReviewInput?.controller).toEqual({
      kind: 'channel_ingress',
      ingressId: 'ingress-1',
    });
  });
});

function makeProposal(id: string): MemoryProposal {
  return createMemoryProposal({
    id,
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
    originalContent: 'Original content.',
    originalCategory: 'general',
    proposerSnapshot: {
      principalType: accessContext.principalType,
      principalId: accessContext.principalId,
      policySnapshotVersion: accessContext.policySnapshotVersion,
    },
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
}

class FakeWorkspaceMemoryRepository implements WorkspaceMemoryRepository {
  public lastReviewInput: ReviewMemoryProposalRepositoryInput | null = null;

  public constructor(private readonly proposals: MemoryProposal[]) {}

  public async createProposal(proposal: MemoryProposal) {
    this.proposals.push(proposal);
    return proposal;
  }

  public async findProposalByIdForOwner(proposalId: string) {
    return (
      this.proposals.find((proposal) => proposal.id === proposalId) ?? null
    );
  }

  public async listProposalsByOwnerScope() {
    return this.proposals;
  }

  public async reviewProposal(input: ReviewMemoryProposalRepositoryInput) {
    this.lastReviewInput = input;
    const proposal = await this.findProposalByIdForOwner(input.proposalId);
    if (!proposal) {
      throw new Error('not found');
    }
    const reviewed = reviewProposalDomain(proposal, {
      outcome: input.outcome,
      reviewedContent: input.reviewedContent ?? null,
      reviewerSnapshot: input.reviewerSnapshot,
      ...(input.now ? { now: input.now } : {}),
    });
    const entry: WorkspaceMemoryEntry | null =
      reviewed.status === 'accepted'
        ? createWorkspaceMemoryEntryFromAcceptedProposal(reviewed)
        : null;
    return { proposal: reviewed, entry };
  }

  public async listAcceptedEntriesByOwnerScope() {
    return [];
  }
}
