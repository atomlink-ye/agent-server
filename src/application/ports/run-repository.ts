import type { Run } from '../../domain/runs/run.js';
import type { OwnerScope } from '../../domain/tenancy/owner-scope.js';

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

export interface FinalizeWaitingOptions {
  readonly runId: string;
  readonly status: 'succeeded' | 'failed' | 'cancelled';
  readonly result?: Run['result'];
  readonly error?: Run['error'];
  readonly updatedAt: string;
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

export interface ExpiredRunRecovery {
  readonly runId: string;
  readonly taskId: string;
}

export type RunOwnerScope = OwnerScope;

export interface RunRepository {
  save(run: Run, options?: SaveRunOptions): Promise<void>;
  findById(id: string): Promise<Run | null>;
  findByIdForOwner(id: string, ownerScope: RunOwnerScope): Promise<Run | null>;
  findByTaskId(taskId: string): Promise<Run | null>;
  hasNonterminalRunsForTeamMemberChildTasks?(
    rootTaskId: string,
    teamMemberRunIds: readonly string[],
    ownerScope: RunOwnerScope,
  ): Promise<boolean>;
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
  releaseClaimedToWaiting?(claim: ClaimedRun): Promise<Run>;
  finalizeWaiting?(options: FinalizeWaitingOptions): Promise<Run>;
  /**
   * Fails closed any plain run still `running` whose lease has expired
   * (crashed/abandoned worker). Never touches a run whose lease is still
   * valid, so a live worker's own completion write can never be stolen.
   */
  recoverExpiredRuns?(now: string): Promise<readonly ExpiredRunRecovery[]>;
}

export class RunCompletionConflictError extends Error {
  public constructor() {
    super('The claimed run has a stale or invalid fencing activation.');
    this.name = 'RunCompletionConflictError';
  }
}
