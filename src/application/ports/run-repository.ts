import type { Run } from '../../domain/runs/run.js';

export interface SaveRunOptions {
  readonly taskId?: string;
  readonly attempt?: number;
}

export interface ClaimedRun {
  readonly run: Run;
  readonly taskId: string;
  readonly attempt: number;
  readonly workerId: string;
  readonly activationId: string;
  readonly fencingToken: number;
  readonly leaseExpiresAt: string;
}

export interface ClaimNextQueuedRunOptions {
  readonly workerId: string;
  readonly activationId: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}

export interface ClaimQueuedRunByIdOptions extends ClaimNextQueuedRunOptions {
  readonly runId: string;
}

export interface CompleteClaimedRunOptions {
  readonly claim: ClaimedRun;
  readonly run: Run;
}

export type CancellationOutcome =
  | 'queued_cancelled'
  | 'running_requested'
  | 'running_already_requested'
  | 'terminal';

export interface CancellationRequestResult {
  readonly runId: string;
  readonly outcome: CancellationOutcome;
}

export interface RunOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export interface RunRepository {
  save(run: Run, options?: SaveRunOptions): Promise<void>;
  findById(id: string): Promise<Run | null>;
  findByIdForOwner(id: string, ownerScope: RunOwnerScope): Promise<Run | null>;
  findByTaskId(taskId: string): Promise<Run | null>;
  requestCancellation(
    taskId: string,
    requestedAt: string,
  ): Promise<CancellationRequestResult | null>;
  claimNextQueued(
    options: ClaimNextQueuedRunOptions,
  ): Promise<ClaimedRun | null>;
  claimQueuedById(
    options: ClaimQueuedRunByIdOptions,
  ): Promise<ClaimedRun | null>;
  completeClaimed(options: CompleteClaimedRunOptions): Promise<Run>;
}

export class RunCompletionConflictError extends Error {
  public constructor() {
    super('The claimed run has a stale or invalid fencing activation.');
    this.name = 'RunCompletionConflictError';
  }
}
