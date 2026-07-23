import { randomUUID } from 'node:crypto';

import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import { createRun } from '../../domain/runs/run.js';
import {
  createChildTask,
  transitionTask,
  type Task,
} from '../../domain/tasks/task.js';
import type { AgentRuntimePort } from '../ports/agent-runtime.js';
import { RuntimeTimedOutError } from '../ports/agent-runtime.js';
import type {
  InvokableOwnerScope,
  InvokableRepository,
} from '../ports/invokable-repository.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { CompleteRun } from '../runs/complete-run.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
} from '../runs/runtime-execution-receipt.js';
import {
  decodeRootTaskRunRequestSnapshotRef,
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

export interface ExecuteTeamTaskInput {
  readonly claim: ClaimedRun;
  readonly task: Task;
}

export class ExecuteTeamTask {
  public constructor(
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly invokables: InvokableRepository,
    private readonly runtime: AgentRuntimePort,
    private readonly completeRun: CompleteRun,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: ExecuteTeamTaskInput): Promise<Run> {
    const ownerScope = toInvokableOwnerScope(input.task);
    const teamVersion = await this.invokables.findPublishedTeamVersionById(
      input.task.invokableVersionId,
      ownerScope,
    );

    if (!teamVersion?.compiledPlan) {
      throw new Error(
        'Published team version could not be loaded for execution',
      );
    }

    let stepInput = decodeRootTaskRunRequestSnapshotRef(
      input.task.inputSnapshotRef,
    ).prompt;
    let finalChildRun: Run | null = null;

    for (const step of teamVersion.compiledPlan.steps) {
      const agentVersion = await this.invokables.findPublishedAgentVersionById(
        step.agentVersionId,
        ownerScope,
      );

      if (!agentVersion) {
        throw new Error(
          `Published agent version ${step.agentVersionId} could not be loaded for team execution`,
        );
      }

      const normalizedInput = normalizeRootTaskRunRequest({
        prompt: stepInput,
      });
      const timestamp = this.now();
      const frozenNow = () => timestamp;
      const childTask = createChildTask({
        tenantId: input.task.tenantId,
        workspaceId: input.task.workspaceId,
        principalType: input.task.principalType,
        principalId: input.task.principalId,
        policySnapshotVersion: input.task.policySnapshotVersion,
        rootTaskId: input.task.rootTaskId,
        parentTaskId: input.task.id,
        parentRunId: input.claim.run.id,
        invokableKind: 'agent',
        invokableVersionId: agentVersion.id,
        inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef(normalizedInput),
        inputFingerprint: fingerprintRootTaskRunRequest(normalizedInput),
        logicalStepKey: step.nodeId,
        nodePath: step.nodePath,
        now: frozenNow,
      });
      const childRun = createRun(normalizedInput.prompt, { now: frozenNow });

      await this.tasks.save(childTask);
      await this.runs.save(childRun, { taskId: childTask.id, attempt: 1 });

      const childClaim = await this.runs.claimQueuedById({
        runId: childRun.id,
        workerId: input.claim.workerId,
        activationId: randomUUID(),
        claimedAt: timestamp.toISOString(),
        leaseExpiresAt: input.claim.leaseExpiresAt,
      });

      if (!childClaim) {
        throw new Error(`Child run ${childRun.id} could not be claimed inline`);
      }

      await this.tasks.save(
        transitionTask(
          childTask,
          'active',
          () => new Date(childClaim.run.updatedAt),
        ),
      );

      finalChildRun = await this.executeChildAgentRun(
        childClaim,
        buildPublishedAgentPrompt(
          agentVersion.instructions,
          normalizedInput.prompt,
        ),
      );

      if (finalChildRun.status !== 'succeeded') {
        return transitionRun(
          input.claim.run,
          finalChildRun.status === 'timed_out' ? 'timed_out' : 'failed',
          finalChildRun.error ? { error: finalChildRun.error } : {},
          this.now,
        );
      }

      stepInput = finalChildRun.result?.text ?? '';
    }

    if (!finalChildRun?.result) {
      throw new Error(
        'Sequential team execution did not produce a final result',
      );
    }

    return transitionRun(
      input.claim.run,
      'succeeded',
      {
        result: { text: finalChildRun.result.text },
        ...(finalChildRun.runtime ? { runtime: finalChildRun.runtime } : {}),
        ...(finalChildRun.usage ? { usage: finalChildRun.usage } : {}),
      },
      this.now,
    );
  }

  private async executeChildAgentRun(
    claim: ClaimedRun,
    prompt: string,
  ): Promise<Run> {
    try {
      const execution = await this.runtime.execute({
        runId: claim.run.id,
        prompt,
      });
      const succeeded = transitionRun(
        claim.run,
        'succeeded',
        {
          runtime: {
            provider: execution.provider,
            model: execution.model,
          },
          result: { text: execution.text },
          ...(execution.usage ? { usage: execution.usage } : {}),
        },
        this.now,
      );

      try {
        return await this.completeRun.execute({ claim, run: succeeded });
      } catch {
        throw new RunCompletionPersistenceError(
          createRuntimeExecutionReceipt(succeeded, claim.taskId),
        );
      }
    } catch (error) {
      if (error instanceof RunCompletionPersistenceError) {
        throw error;
      }
      const failure: RunFailure =
        error instanceof RuntimeTimedOutError
          ? {
              code: 'runtime_timed_out',
              message: 'The runtime exceeded the configured timeout.',
            }
          : {
              code: 'runtime_execution_failed',
              message: 'The runtime could not complete the run.',
            };
      const failed = transitionRun(
        claim.run,
        error instanceof RuntimeTimedOutError ? 'timed_out' : 'failed',
        { error: failure },
        this.now,
      );

      return this.completeRun.execute({ claim, run: failed });
    }
  }
}

export function buildPublishedAgentPrompt(
  instructions: string,
  inputText: string,
): string {
  return `${instructions.trim()}\n\nTask input:\n${inputText.trim()}`;
}

function toInvokableOwnerScope(task: Task): InvokableOwnerScope {
  return {
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    principalType: task.principalType,
    principalId: task.principalId,
  };
}
