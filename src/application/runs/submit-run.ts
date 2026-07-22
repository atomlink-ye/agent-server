import { randomUUID } from 'node:crypto';

import type { Run } from '../../domain/runs/run.js';
import { AdmitRootTask } from '../tasks/admit-root-task.js';
import type { RunRepository } from '../ports/run-repository.js';

export interface SubmitRunResult {
  readonly run: Run;
  readonly reused: boolean;
}

export class SubmitRun {
  public constructor(
    private readonly admitRootTask: AdmitRootTask,
    private readonly repository: RunRepository,
  ) {}

  public async replayIfAccepted(
    prompt: string,
    idempotencyKey: string,
  ): Promise<SubmitRunResult | null> {
    const admission = await this.admitRootTask.findAccepted({
      prompt,
      idempotencyKey,
    });

    if (!admission) {
      return null;
    }

    return {
      run: await this.loadRun(admission.runId),
      reused: true,
    };
  }

  public async execute(
    prompt: string,
    idempotencyKey?: string,
  ): Promise<SubmitRunResult> {
    const admission = await this.admitRootTask.execute({
      prompt,
      idempotencyKey: idempotencyKey ?? randomUUID(),
    });

    return {
      run: await this.loadRun(admission.runId),
      reused: admission.reused,
    };
  }

  private async loadRun(runId: string): Promise<Run> {
    const run = await this.repository.findById(runId);

    if (!run) {
      throw new Error('Admitted run could not be reloaded');
    }

    return run;
  }
}
