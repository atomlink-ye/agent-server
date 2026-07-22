import { randomUUID } from 'node:crypto';

import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';

export interface ClaimNextRunOptions {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly now?: () => Date;
  readonly activationIdFactory?: () => string;
}

export class ClaimNextRun {
  readonly #now: () => Date;
  readonly #activationIdFactory: () => string;

  public constructor(
    private readonly repository: RunRepository,
    private readonly options: ClaimNextRunOptions,
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#activationIdFactory = options.activationIdFactory ?? randomUUID;
  }

  public async execute(): Promise<ClaimedRun | null> {
    const claimedAt = this.#now();

    return this.repository.claimNextQueued({
      workerId: this.options.workerId,
      activationId: this.#activationIdFactory(),
      claimedAt: claimedAt.toISOString(),
      leaseExpiresAt: new Date(
        claimedAt.getTime() + this.options.leaseDurationMs,
      ).toISOString(),
    });
  }
}
