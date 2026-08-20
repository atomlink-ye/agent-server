import type { WorkOwnerScope } from './work.js';

export type WorkRunId = string;
export type WorkRunTriggerKind = 'manual' | 'webhook' | 'schedule';

export interface WorkRun {
  readonly id: WorkRunId;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
  readonly definitionVersionId: string;
  readonly predecessorWorkRunId?: string | null;
  readonly triggerKind: WorkRunTriggerKind;
  readonly triggerRef: string;
  readonly idempotencyKey: string;
  readonly rootTaskId: string | null;
  readonly expiresAt: string;
  readonly boundAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PendingWorkRun = WorkRun & {
  readonly rootTaskId: null;
  readonly boundAt: null;
};
export type BoundWorkRun = WorkRun & {
  readonly rootTaskId: string;
  readonly boundAt: string;
};

export interface CreatePendingWorkRunInput {
  readonly id: WorkRunId;
  readonly owner: WorkOwnerScope;
  readonly workId: string;
  readonly definitionVersionId: string;
  readonly predecessorWorkRunId?: string | null;
  readonly triggerKind: WorkRunTriggerKind;
  readonly triggerRef: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export class InvalidWorkRunError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkRunError';
  }
}

export class WorkRunNotFoundError extends Error {
  public constructor() {
    super('The work run was not found for the requested owner scope.');
    this.name = 'WorkRunNotFoundError';
  }
}

export class WorkRunBindingConflictError extends Error {
  public constructor() {
    super('The work run is already bound to a different root task.');
    this.name = 'WorkRunBindingConflictError';
  }
}

export class PendingWorkRunExpiredError extends Error {
  public constructor() {
    super('The pending work run has expired and cannot be bound.');
    this.name = 'PendingWorkRunExpiredError';
  }
}

export class ResolvedManifestConflictError extends Error {
  public constructor() {
    super('The resolved resource manifest conflicts with an existing entry.');
    this.name = 'ResolvedManifestConflictError';
  }
}

export function createPendingWorkRun(
  input: CreatePendingWorkRunInput,
): PendingWorkRun {
  if (!input.id || !input.owner.tenantId || !input.owner.workspaceId)
    throw new InvalidWorkRunError(
      'A work run id and owner scope are required.',
    );
  if (
    !input.workId ||
    !input.definitionVersionId ||
    !input.triggerRef ||
    !input.idempotencyKey
  )
    throw new InvalidWorkRunError(
      'Work, trigger, and idempotency values are required.',
    );
  const now = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id,
    tenantId: input.owner.tenantId,
    workspaceId: input.owner.workspaceId,
    workId: input.workId,
    definitionVersionId: input.definitionVersionId,
    predecessorWorkRunId: input.predecessorWorkRunId ?? null,
    triggerKind: input.triggerKind,
    triggerRef: input.triggerRef,
    idempotencyKey: input.idempotencyKey,
    rootTaskId: null,
    expiresAt: input.expiresAt,
    boundAt: null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
  };
}
