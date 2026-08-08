import { randomUUID } from 'node:crypto';

import {
  assertIsoInstant,
  assertNonEmptyString,
  type InvokableOwnerScope,
  assertInvokableOwnerScope,
} from '../invokables/invokable.js';

export type TeamCompletionDecisionKind = 'approve' | 'reject';

export interface TeamCompletionDecisionTarget {
  readonly workItemId: string;
  readonly attemptNoAtDecision: number;
}

export interface TeamCompletionDecision extends InvokableOwnerScope {
  readonly id: string;
  readonly teamRunId: string;
  readonly completionRequestedByRunId: string;
  readonly decision: TeamCompletionDecisionKind;
  readonly feedback: string | null;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly teamRevisionAtDecision: number;
  readonly leadTurnCountAtDecision: number;
  readonly targets: readonly TeamCompletionDecisionTarget[];
}

export type TeamCompletionDecisionSnapshot = TeamCompletionDecision;

export interface CreateTeamCompletionDecisionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly teamRunId: string;
  readonly completionRequestedByRunId: string;
  readonly decision: TeamCompletionDecisionKind;
  readonly feedback?: string | null;
  readonly decidedBy: string;
  readonly decidedAt?: string;
  readonly teamRevisionAtDecision?: number;
  readonly leadTurnCountAtDecision: number;
  readonly targets?: readonly TeamCompletionDecisionTarget[];
  readonly now?: () => Date;
}

type TeamCompletionDecisionInput = Omit<
  TeamCompletionDecision,
  'feedback' | 'targets'
> & {
  readonly feedback?: string | null;
  readonly targets?: readonly TeamCompletionDecisionTarget[];
};

/** Normalize persisted/user supplied decision fields before shape validation. */
export function normalizeTeamCompletionDecision(
  decision: TeamCompletionDecisionInput,
): TeamCompletionDecisionInput {
  return {
    ...decision,
    feedback: normalizeDecisionFeedback(decision.feedback),
    targets: (decision.targets ?? []).map((target) => ({ ...target })),
  };
}

export function normalizeDecisionFeedback(
  feedback?: string | null,
): string | null {
  if (feedback === undefined || feedback === null) return null;
  const normalized = feedback.trim();
  return normalized.length > 0 ? normalized : null;
}

export function createTeamCompletionDecision(
  options: CreateTeamCompletionDecisionOptions,
): TeamCompletionDecision {
  const decidedAt =
    options.decidedAt ?? (options.now ?? (() => new Date()))().toISOString();

  return rehydrateTeamCompletionDecision({
    id: options.id ?? randomUUID(),
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    teamRunId: options.teamRunId,
    completionRequestedByRunId: options.completionRequestedByRunId,
    decision: options.decision,
    feedback: options.feedback ?? null,
    decidedBy: options.decidedBy,
    decidedAt,
    teamRevisionAtDecision: options.teamRevisionAtDecision ?? 0,
    leadTurnCountAtDecision: options.leadTurnCountAtDecision,
    targets: options.targets ?? [],
  });
}

export function rehydrateTeamCompletionDecision(
  snapshot: TeamCompletionDecisionSnapshot,
): TeamCompletionDecision {
  const normalized = normalizeTeamCompletionDecision(snapshot);

  assertInvokableOwnerScope(normalized, 'Team completion decision');
  assertNonEmptyString('id', normalized.id, 'Team completion decision');
  assertNonEmptyString(
    'teamRunId',
    normalized.teamRunId,
    'Team completion decision',
  );
  assertNonEmptyString(
    'completionRequestedByRunId',
    normalized.completionRequestedByRunId,
    'Team completion decision',
  );
  assertNonEmptyString(
    'decidedBy',
    normalized.decidedBy,
    'Team completion decision',
  );
  assertIsoInstant(
    'decidedAt',
    normalized.decidedAt,
    'Team completion decision',
  );
  assertDecisionKind(normalized.decision);
  assertNonNegativeInteger(
    'teamRevisionAtDecision',
    normalized.teamRevisionAtDecision,
  );
  assertNonNegativeInteger(
    'leadTurnCountAtDecision',
    normalized.leadTurnCountAtDecision,
  );

  const targets = normalized.targets ?? [];
  const targetIds = new Set<string>();
  for (const target of targets) {
    assertNonEmptyString(
      'targets.workItemId',
      target.workItemId,
      'Team completion decision',
    );
    assertPositiveInteger(
      'targets.attemptNoAtDecision',
      target.attemptNoAtDecision,
    );
    if (targetIds.has(target.workItemId)) {
      throw new Error(
        'Team completion decision targets must contain unique work items',
      );
    }
    targetIds.add(target.workItemId);
  }

  if (normalized.decision === 'reject') {
    if (normalized.feedback === null) {
      throw new Error(
        'Rejected team completion decisions require non-blank feedback',
      );
    }
    if (targets.length === 0) {
      throw new Error(
        'Rejected team completion decisions require at least one target',
      );
    }
  } else if (normalized.feedback !== null || targets.length > 0) {
    throw new Error(
      'Approved team completion decisions cannot include feedback or targets',
    );
  }

  return Object.freeze({
    ...normalized,
    feedback: normalized.feedback ?? null,
    targets: Object.freeze(
      targets.map((target) => Object.freeze({ ...target })),
    ),
  });
}

function assertDecisionKind(
  decision: TeamCompletionDecisionKind,
): asserts decision is TeamCompletionDecisionKind {
  if (decision !== 'approve' && decision !== 'reject') {
    throw new Error('Team completion decision has an unsupported decision');
  }
}

function assertNonNegativeInteger(fieldName: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Team completion decision field ${fieldName} must be a non-negative integer`,
    );
  }
}

function assertPositiveInteger(fieldName: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `Team completion decision field ${fieldName} must be a positive integer`,
    );
  }
}
