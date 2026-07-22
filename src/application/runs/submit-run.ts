import { randomUUID } from 'node:crypto';

import type { RunOwnerScope } from '../ports/run-repository.js';
import type { Run } from '../../domain/runs/run.js';
import type { AccessContext } from '../control-plane/access-context.js';
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
    accessContext: AccessContext,
  ): Promise<SubmitRunResult | null> {
    const admission = await this.admitRootTask.findAccepted({
      prompt,
      idempotencyKey,
      accessContext,
    });

    if (!admission) {
      return null;
    }

    return {
      run: await this.loadRun(admission.runId, accessContext),
      reused: true,
    };
  }

  public async execute(
    prompt: string,
    accessContext: AccessContext,
    idempotencyKey?: string,
  ): Promise<SubmitRunResult> {
    const admission = await this.admitRootTask.execute({
      prompt,
      idempotencyKey: idempotencyKey ?? randomUUID(),
      accessContext,
    });

    return {
      run: await this.loadRun(admission.runId, accessContext),
      reused: admission.reused,
    };
  }

  private async loadRun(
    runId: string,
    accessContext: AccessContext,
  ): Promise<Run> {
    const run = await this.repository.findByIdForOwner(
      runId,
      toRunOwnerScope(accessContext),
    );

    if (!run) {
      throw new Error('Admitted run could not be reloaded');
    }

    return run;
  }
}

function toRunOwnerScope(accessContext: AccessContext): RunOwnerScope {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}
