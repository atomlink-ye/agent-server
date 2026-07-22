import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import type { Run } from '../../domain/runs/run.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';

export interface CompleteRunInput {
  readonly claim: ClaimedRun;
  readonly run: Run;
}

export class CompleteRun {
  public constructor(private readonly repository: RunRepository) {}

  public async execute(input: CompleteRunInput): Promise<Run> {
    if (!terminalRunStatuses.has(input.run.status)) {
      throw new Error('Run completion requires a terminal run status');
    }

    return this.repository.completeClaimed(input);
  }
}
