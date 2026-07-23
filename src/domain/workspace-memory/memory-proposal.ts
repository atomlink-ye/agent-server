import { randomUUID } from 'node:crypto';

export type MemoryProposalStatus = 'pending' | 'accepted' | 'rejected';
export type MemoryReviewOutcome = 'accept' | 'edit_and_accept' | 'reject';
export type AcceptedMemoryReviewOutcome = Exclude<
  MemoryReviewOutcome,
  'reject'
>;

const MEMORY_PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected'] as const;
const MEMORY_REVIEW_OUTCOMES = ['accept', 'edit_and_accept', 'reject'] as const;
const ACCEPTED_MEMORY_REVIEW_OUTCOMES = ['accept', 'edit_and_accept'] as const;

export interface WorkspaceMemoryOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export interface WorkspaceMemoryActorSnapshot {
  readonly principalType: string;
  readonly principalId: string;
  readonly policySnapshotVersion: string;
}

export interface MemoryProposal extends WorkspaceMemoryOwnerScope {
  readonly id: string;
  readonly originalContent: string;
  readonly originalCategory: string;
  readonly sourceTaskId: string | null;
  readonly sourceSessionId: string | null;
  readonly proposerSnapshot: WorkspaceMemoryActorSnapshot;
  readonly status: MemoryProposalStatus;
  readonly reviewOutcome: MemoryReviewOutcome | null;
  readonly reviewedContent: string | null;
  readonly reviewerSnapshot: WorkspaceMemoryActorSnapshot | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MemoryProposalSnapshot = MemoryProposal;

export interface WorkspaceMemoryEntry extends WorkspaceMemoryOwnerScope {
  readonly id: string;
  readonly proposalId: string;
  readonly content: string;
  readonly category: string;
  readonly sourceTaskId: string | null;
  readonly sourceSessionId: string | null;
  readonly proposerSnapshot: WorkspaceMemoryActorSnapshot;
  readonly reviewerSnapshot: WorkspaceMemoryActorSnapshot;
  readonly reviewOutcome: AcceptedMemoryReviewOutcome;
  readonly acceptedAt: string;
}

export type WorkspaceMemoryEntrySnapshot = WorkspaceMemoryEntry;

export interface CreateMemoryProposalOptions extends WorkspaceMemoryOwnerScope {
  readonly id?: string;
  readonly originalContent: string;
  readonly originalCategory: string;
  readonly sourceTaskId?: string | null;
  readonly sourceSessionId?: string | null;
  readonly proposerSnapshot: WorkspaceMemoryActorSnapshot;
  readonly now?: () => Date;
}

export interface ReviewMemoryProposalOptions {
  readonly outcome: MemoryReviewOutcome;
  readonly reviewedContent?: string | null;
  readonly reviewerSnapshot: WorkspaceMemoryActorSnapshot;
  readonly now?: () => Date;
}

export interface CreateWorkspaceMemoryEntryOptions {
  readonly id?: string;
}

export class NonPendingMemoryProposalReviewError extends Error {
  public constructor(proposalId: string, status: MemoryProposalStatus) {
    super(
      `Memory proposal ${proposalId} is non-pending and cannot be reviewed again (status: ${status})`,
    );
    this.name = 'NonPendingMemoryProposalReviewError';
  }
}

export function createMemoryProposal(
  options: CreateMemoryProposalOptions,
): MemoryProposal {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();

  return rehydrateMemoryProposal({
    id: options.id ?? randomUUID(),
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    originalContent: options.originalContent,
    originalCategory: options.originalCategory,
    sourceTaskId: options.sourceTaskId ?? null,
    sourceSessionId: options.sourceSessionId ?? null,
    proposerSnapshot: options.proposerSnapshot,
    status: 'pending',
    reviewOutcome: null,
    reviewedContent: null,
    reviewerSnapshot: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function reviewMemoryProposal(
  proposal: MemoryProposal,
  options: ReviewMemoryProposalOptions,
): MemoryProposal {
  if (proposal.status !== 'pending') {
    throw new NonPendingMemoryProposalReviewError(proposal.id, proposal.status);
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const reviewedContent =
    options.outcome === 'edit_and_accept'
      ? assertNonEmptyString(
          'reviewedContent',
          options.reviewedContent ?? null,
          'Edit-and-accept review',
        )
      : (options.reviewedContent ?? null);

  if (options.outcome === 'accept' && reviewedContent !== null) {
    throw new Error('Accept review cannot include reviewedContent');
  }

  if (options.outcome === 'reject' && reviewedContent !== null) {
    throw new Error('Reject review cannot include reviewedContent');
  }

  return rehydrateMemoryProposal({
    ...proposal,
    status: options.outcome === 'reject' ? 'rejected' : 'accepted',
    reviewOutcome: options.outcome,
    reviewedContent,
    reviewerSnapshot: options.reviewerSnapshot,
    reviewedAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createWorkspaceMemoryEntryFromAcceptedProposal(
  proposal: MemoryProposal,
  options: CreateWorkspaceMemoryEntryOptions = {},
): WorkspaceMemoryEntry {
  if (proposal.status !== 'accepted') {
    throw new Error('Workspace memory entry requires an accepted proposal');
  }

  if (
    proposal.reviewOutcome !== 'accept' &&
    proposal.reviewOutcome !== 'edit_and_accept'
  ) {
    throw new Error('Workspace memory entry requires an acceptance outcome');
  }

  if (proposal.reviewerSnapshot === null || proposal.reviewedAt === null) {
    throw new Error('Workspace memory entry requires reviewer metadata');
  }

  return rehydrateWorkspaceMemoryEntry({
    id: options.id ?? randomUUID(),
    proposalId: proposal.id,
    tenantId: proposal.tenantId,
    workspaceId: proposal.workspaceId,
    principalType: proposal.principalType,
    principalId: proposal.principalId,
    content:
      proposal.reviewOutcome === 'edit_and_accept'
        ? assertNonEmptyString(
            'reviewedContent',
            proposal.reviewedContent,
            'Accepted memory proposal',
          )
        : proposal.originalContent,
    category: proposal.originalCategory,
    sourceTaskId: proposal.sourceTaskId,
    sourceSessionId: proposal.sourceSessionId,
    proposerSnapshot: proposal.proposerSnapshot,
    reviewerSnapshot: proposal.reviewerSnapshot,
    reviewOutcome: proposal.reviewOutcome,
    acceptedAt: proposal.reviewedAt,
  });
}

export function rehydrateMemoryProposal(
  snapshot: MemoryProposalSnapshot,
): MemoryProposal {
  assertOwnerScope(snapshot);
  assertNonEmptyString('id', snapshot.id, 'Memory proposal');
  assertNonEmptyString(
    'originalContent',
    snapshot.originalContent,
    'Memory proposal',
  );
  assertNonEmptyString(
    'originalCategory',
    snapshot.originalCategory,
    'Memory proposal',
  );
  assertActorSnapshot('proposerSnapshot', snapshot.proposerSnapshot);
  assertEnumValue(
    'status',
    snapshot.status,
    MEMORY_PROPOSAL_STATUSES,
    'Memory proposal',
  );
  assertNullableEnumValue(
    'reviewOutcome',
    snapshot.reviewOutcome,
    MEMORY_REVIEW_OUTCOMES,
    'Memory proposal',
  );
  assertProposalReviewShape(snapshot);
  assertIsoInstant('createdAt', snapshot.createdAt);
  assertIsoInstant('updatedAt', snapshot.updatedAt);
  if (Date.parse(snapshot.updatedAt) < Date.parse(snapshot.createdAt)) {
    throw new Error('Memory proposal updatedAt must be >= createdAt');
  }

  return Object.freeze({ ...snapshot });
}

export function rehydrateWorkspaceMemoryEntry(
  snapshot: WorkspaceMemoryEntrySnapshot,
): WorkspaceMemoryEntry {
  assertOwnerScope(snapshot);
  assertNonEmptyString('id', snapshot.id, 'Workspace memory entry');
  assertNonEmptyString(
    'proposalId',
    snapshot.proposalId,
    'Workspace memory entry',
  );
  assertNonEmptyString('content', snapshot.content, 'Workspace memory entry');
  assertNonEmptyString('category', snapshot.category, 'Workspace memory entry');
  assertActorSnapshot('proposerSnapshot', snapshot.proposerSnapshot);
  assertActorSnapshot('reviewerSnapshot', snapshot.reviewerSnapshot);
  assertEnumValue(
    'reviewOutcome',
    snapshot.reviewOutcome,
    ACCEPTED_MEMORY_REVIEW_OUTCOMES,
    'Workspace memory entry',
  );
  assertIsoInstant('acceptedAt', snapshot.acceptedAt);

  return Object.freeze({ ...snapshot });
}

function assertProposalReviewShape(proposal: MemoryProposalSnapshot): void {
  if (proposal.status === 'pending') {
    if (
      proposal.reviewOutcome !== null ||
      proposal.reviewedContent !== null ||
      proposal.reviewerSnapshot !== null ||
      proposal.reviewedAt !== null
    ) {
      throw new Error('Pending memory proposal cannot include review metadata');
    }
    return;
  }

  if (proposal.reviewOutcome === null || proposal.reviewerSnapshot === null) {
    throw new Error('Reviewed memory proposal requires review metadata');
  }
  assertActorSnapshot('reviewerSnapshot', proposal.reviewerSnapshot);
  if (proposal.reviewedAt === null) {
    throw new Error('Reviewed memory proposal requires reviewedAt');
  }
  assertIsoInstant('reviewedAt', proposal.reviewedAt);
  if (proposal.status === 'accepted' && proposal.reviewOutcome === 'reject') {
    throw new Error('Accepted memory proposal cannot have reject outcome');
  }
  if (proposal.status === 'rejected' && proposal.reviewOutcome !== 'reject') {
    throw new Error('Rejected memory proposal must have reject outcome');
  }
  if (proposal.reviewOutcome === 'edit_and_accept') {
    assertNonEmptyString(
      'reviewedContent',
      proposal.reviewedContent,
      'Edit-and-accept review',
    );
    return;
  }
  if (proposal.reviewedContent !== null) {
    throw new Error(
      'Non-edited memory proposal review cannot include reviewedContent',
    );
  }
}

function assertOwnerScope(scope: WorkspaceMemoryOwnerScope): void {
  assertNonEmptyString(
    'tenantId',
    scope.tenantId,
    'Workspace memory owner scope',
  );
  assertNonEmptyString(
    'workspaceId',
    scope.workspaceId,
    'Workspace memory owner scope',
  );
  assertNonEmptyString(
    'principalType',
    scope.principalType,
    'Workspace memory owner scope',
  );
  assertNonEmptyString(
    'principalId',
    scope.principalId,
    'Workspace memory owner scope',
  );
}

function assertActorSnapshot(
  fieldName: string,
  snapshot: WorkspaceMemoryActorSnapshot,
): void {
  assertNonEmptyString(
    `${fieldName}.principalType`,
    snapshot.principalType,
    'Workspace memory actor snapshot',
  );
  assertNonEmptyString(
    `${fieldName}.principalId`,
    snapshot.principalId,
    'Workspace memory actor snapshot',
  );
  assertNonEmptyString(
    `${fieldName}.policySnapshotVersion`,
    snapshot.policySnapshotVersion,
    'Workspace memory actor snapshot',
  );
}

function assertNonEmptyString(
  fieldName: string,
  value: string | null,
  subject: string,
): string {
  if (value === null || value.trim().length === 0) {
    throw new Error(
      `${subject} requires ${fieldName} to be a non-empty string`,
    );
  }

  return value;
}

function assertEnumValue<T extends string>(
  fieldName: string,
  value: string,
  allowedValues: readonly T[],
  subject: string,
): asserts value is T {
  if (!allowedValues.includes(value as T)) {
    throw new Error(
      `${subject} requires ${fieldName} to be one of: ${allowedValues.join(', ')}`,
    );
  }
}

function assertNullableEnumValue<T extends string>(
  fieldName: string,
  value: string | null,
  allowedValues: readonly T[],
  subject: string,
): asserts value is T | null {
  if (value !== null) {
    assertEnumValue(fieldName, value, allowedValues, subject);
  }
}

function assertIsoInstant(fieldName: string, value: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a valid ISO-8601 instant`);
  }
}
