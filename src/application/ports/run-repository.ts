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

export interface CompleteClaimedRunOptions {
  readonly claim: ClaimedRun;
  readonly run: Run;
}

export interface RunRepository {
  save(run: Run, options?: SaveRunOptions): Promise<void>;
  findById(id: string): Promise<Run | null>;
  findByTaskId(taskId: string): Promise<Run | null>;
  claimNextQueued(
    options: ClaimNextQueuedRunOptions,
  ): Promise<ClaimedRun | null>;
  completeClaimed(options: CompleteClaimedRunOptions): Promise<Run>;
}

export class RunCompletionConflictError extends Error {
  public constructor() {
    super('The claimed run has a stale or invalid fencing activation.');
    this.name = 'RunCompletionConflictError';
  }
}
