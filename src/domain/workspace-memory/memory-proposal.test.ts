import { describe, expect, it } from 'vitest';

import {
  createMemoryProposal,
  createWorkspaceMemoryEntryFromAcceptedProposal,
  NonPendingMemoryProposalReviewError,
  rehydrateMemoryProposal,
  rehydrateWorkspaceMemoryEntry,
  reviewMemoryProposal,
} from './memory-proposal.js';

const ownerScope = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account',
  principalId: 'svc_alpha',
} as const;

const proposerSnapshot = {
  principalType: 'service_account',
  principalId: 'svc_alpha',
  policySnapshotVersion: 'policy-2026-07-23',
} as const;

const reviewerSnapshot = {
  principalType: 'service_account',
  principalId: 'reviewer_alpha',
  policySnapshotVersion: 'policy-2026-07-23-review',
} as const;

describe('workspace memory proposal domain', () => {
  it('creates a pending proposal with owner scope, source provenance, and proposer snapshot', () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000090001',
      ...ownerScope,
      originalContent: 'Remember that ACME prefers async status updates.',
      originalCategory: 'customer_preference',
      sourceTaskId: '00000000-0000-4000-8000-000000010001',
      sourceSessionId: 'session-alpha',
      proposerSnapshot,
      now: () => new Date('2026-07-23T10:00:00.000Z'),
    });

    expect(proposal).toMatchObject({
      id: '00000000-0000-4000-8000-000000090001',
      ...ownerScope,
      originalContent: 'Remember that ACME prefers async status updates.',
      originalCategory: 'customer_preference',
      sourceTaskId: '00000000-0000-4000-8000-000000010001',
      sourceSessionId: 'session-alpha',
      proposerSnapshot,
      status: 'pending',
      reviewOutcome: null,
      reviewedContent: null,
      reviewerSnapshot: null,
      reviewedAt: null,
      createdAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
    });
  });

  it('accepts edited proposal content into a workspace memory entry', () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000090002',
      ...ownerScope,
      originalContent: 'Original phrasing',
      originalCategory: 'preference',
      sourceTaskId: null,
      sourceSessionId: 'session-beta',
      proposerSnapshot,
      now: () => new Date('2026-07-23T10:00:00.000Z'),
    });

    const reviewed = reviewMemoryProposal(proposal, {
      outcome: 'edit_and_accept',
      reviewedContent: 'Edited durable phrasing',
      reviewerSnapshot,
      now: () => new Date('2026-07-23T10:05:00.000Z'),
    });
    const entry = createWorkspaceMemoryEntryFromAcceptedProposal(reviewed, {
      id: '00000000-0000-4000-8000-000000090102',
    });

    expect(reviewed).toMatchObject({
      status: 'accepted',
      reviewOutcome: 'edit_and_accept',
      reviewedContent: 'Edited durable phrasing',
      reviewerSnapshot,
      reviewedAt: '2026-07-23T10:05:00.000Z',
      updatedAt: '2026-07-23T10:05:00.000Z',
    });
    expect(entry).toMatchObject({
      id: '00000000-0000-4000-8000-000000090102',
      proposalId: proposal.id,
      ...ownerScope,
      content: 'Edited durable phrasing',
      category: 'preference',
      sourceTaskId: null,
      sourceSessionId: 'session-beta',
      proposerSnapshot,
      reviewerSnapshot,
      reviewOutcome: 'edit_and_accept',
      acceptedAt: '2026-07-23T10:05:00.000Z',
    });
  });

  it('rejects review of a non-pending proposal with a stable domain error', () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000090003',
      ...ownerScope,
      originalContent: 'Reject once only',
      originalCategory: 'fact',
      sourceTaskId: null,
      sourceSessionId: null,
      proposerSnapshot,
      now: () => new Date('2026-07-23T10:00:00.000Z'),
    });
    const rejected = reviewMemoryProposal(proposal, {
      outcome: 'reject',
      reviewedContent: null,
      reviewerSnapshot,
      now: () => new Date('2026-07-23T10:05:00.000Z'),
    });

    expect(() =>
      reviewMemoryProposal(rejected, {
        outcome: 'accept',
        reviewedContent: null,
        reviewerSnapshot,
        now: () => new Date('2026-07-23T10:06:00.000Z'),
      }),
    ).toThrow(NonPendingMemoryProposalReviewError);
  });

  it('rejects invalid persisted proposal enum values during rehydration', () => {
    const baseProposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000090004',
      ...ownerScope,
      originalContent: 'Enum checks must be explicit.',
      originalCategory: 'fact',
      sourceTaskId: null,
      sourceSessionId: null,
      proposerSnapshot,
      now: () => new Date('2026-07-23T10:00:00.000Z'),
    });

    expect(() =>
      rehydrateMemoryProposal({
        ...baseProposal,
        status: 'archived',
      } as unknown as Parameters<typeof rehydrateMemoryProposal>[0]),
    ).toThrow(/status/i);
    expect(() =>
      rehydrateMemoryProposal({
        ...baseProposal,
        status: 'accepted',
        reviewOutcome: 'defer',
        reviewerSnapshot,
        reviewedAt: '2026-07-23T10:05:00.000Z',
        updatedAt: '2026-07-23T10:05:00.000Z',
      } as unknown as Parameters<typeof rehydrateMemoryProposal>[0]),
    ).toThrow(/reviewOutcome/i);
  });

  it('rejects invalid persisted review shapes during rehydration', () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000090005',
      ...ownerScope,
      originalContent: 'Review shape checks must be explicit.',
      originalCategory: 'fact',
      sourceTaskId: null,
      sourceSessionId: null,
      proposerSnapshot,
      now: () => new Date('2026-07-23T10:00:00.000Z'),
    });

    expect(() =>
      rehydrateMemoryProposal({
        ...proposal,
        status: 'accepted',
        reviewOutcome: 'accept',
        reviewedContent: 'accept should not persist reviewed content',
        reviewerSnapshot,
        reviewedAt: '2026-07-23T10:05:00.000Z',
        updatedAt: '2026-07-23T10:05:00.000Z',
      }),
    ).toThrow(/reviewedContent/i);
    expect(() =>
      rehydrateMemoryProposal({
        ...proposal,
        status: 'accepted',
        reviewOutcome: 'edit_and_accept',
        reviewedContent: '   ',
        reviewerSnapshot,
        reviewedAt: '2026-07-23T10:05:00.000Z',
        updatedAt: '2026-07-23T10:05:00.000Z',
      }),
    ).toThrow(/reviewedContent/i);
  });

  it('rejects invalid persisted entry review outcomes during rehydration', () => {
    expect(() =>
      rehydrateWorkspaceMemoryEntry({
        id: '00000000-0000-4000-8000-000000090105',
        proposalId: '00000000-0000-4000-8000-000000090005',
        ...ownerScope,
        content: 'Accepted memory only.',
        category: 'fact',
        sourceTaskId: null,
        sourceSessionId: null,
        proposerSnapshot,
        reviewerSnapshot,
        reviewOutcome: 'reject',
        acceptedAt: '2026-07-23T10:05:00.000Z',
      } as unknown as Parameters<typeof rehydrateWorkspaceMemoryEntry>[0]),
    ).toThrow(/reviewOutcome/i);
  });
});
