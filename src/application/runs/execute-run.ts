import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { transitionTask } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
import { ResolveAgentVersion } from '../agents/resolve-agent-version.js';
import {
  type AgentRuntimePort,
  RuntimeTimedOutError,
} from '../ports/agent-runtime.js';
import type {
  InvokableOwnerScope,
  InvokableRepository,
} from '../ports/invokable-repository.js';
import type { ClaimedRun } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { FileStore } from '../ports/file-store.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import { assembleContext } from '../context/assemble-context.js';
import {
  buildPublishedAgentPrompt,
  ExecuteTeamTask,
} from '../tasks/execute-team-task.js';
import { CompleteRun } from './complete-run.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
} from './runtime-execution-receipt.js';

export class ExecuteRun {
  public constructor(
    private readonly completeRun: CompleteRun,
    private readonly tasks: TaskRepository,
    private readonly invokables: InvokableRepository,
    private readonly executeTeamTask: ExecuteTeamTask,
    private readonly runtime: AgentRuntimePort,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly resolver: ResolveAgentVersion = new ResolveAgentVersion(
      { findVersion: async () => null },
      invokables,
    ),
    private readonly events?: RunEventRepository,
    private readonly fileStore?: FileStore,
    private readonly createMemoryProposal?: CreateMemoryProposal,
  ) {}

  public async ensureRuntimeReady(): Promise<boolean> {
    try {
      const health = await this.runtime.health();
      if (health.ready) {
        return true;
      }

      await this.runtime.initialize();
      return (await this.runtime.health()).ready;
    } catch (error) {
      this.logger.log('warn', 'run.runtime.unavailable', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return false;
    }
  }

  public async execute(claim: ClaimedRun) {
    this.logger.log('info', 'run.started', {
      run_id: claim.run.id,
      worker_id: claim.workerId,
      activation_id: claim.activationId,
      fencing_token: claim.fencingToken,
    });

    let completed: Run;

    try {
      await this.events?.bind({
        runId: claim.run.id,
        createdAt: claim.run.updatedAt,
      });
      await this.events?.append(claim.run.id, 'started', {});
      const task = await this.tasks.findById(claim.taskId);
      if (!task) {
        throw new Error(
          `Task ${claim.taskId} could not be loaded for execution`,
        );
      }

      if (task.status === 'queued') {
        await this.tasks.save(
          transitionTask(task, 'active', () => new Date(claim.run.updatedAt)),
        );
      }

      const terminalRun =
        task.invokableKind === 'team'
          ? await this.executeTeamTask.execute({ claim, task })
          : await this.executeAgentRun(
              claim,
              {
                tenantId: task.tenantId,
                workspaceId: task.workspaceId,
                principalType: task.principalType,
                principalId: task.principalId,
              },
              task.invokableVersionId,
              task,
            );

      completed = await this.completeTerminalRun(claim, terminalRun);
    } catch (error) {
      if (error instanceof RunCompletionPersistenceError) {
        this.reportCompletionPersistenceFailure(error.receipt);
        throw error;
      }
      const timedOut = error instanceof RuntimeTimedOutError;
      await this.events?.append(claim.run.id, 'failed', {
        code: timedOut ? 'runtime_timed_out' : 'runtime_execution_failed',
      });
      const failure: RunFailure = timedOut
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
        timedOut ? 'timed_out' : 'failed',
        {
          error: failure,
        },
        this.now,
      );
      try {
        completed = await this.completeTerminalRun(claim, failed);
      } catch (completionError) {
        if (completionError instanceof RunCompletionPersistenceError) {
          this.reportCompletionPersistenceFailure(completionError.receipt);
        }
        throw completionError;
      }
    }

    this.reportCompletedRun(claim, completed);
    return completed;
  }

  private async completeTerminalRun(
    claim: ClaimedRun,
    run: Awaited<ReturnType<ExecuteRun['executeAgentRun']>>,
  ) {
    let completed: Awaited<ReturnType<CompleteRun['execute']>>;
    try {
      completed = await this.completeRun.execute({ claim, run });
    } catch (error) {
      const receipt = createRuntimeExecutionReceipt(run, claim.taskId);
      throw new RunCompletionPersistenceError(receipt);
    }

    return completed;
  }

  private reportCompletedRun(claim: ClaimedRun, completed: Run): void {
    this.logger.log(
      completed.status === 'succeeded' ? 'info' : 'error',
      completed.status === 'succeeded' ? 'run.succeeded' : 'run.failed',
      {
        run_id: claim.run.id,
        ...(completed.runtime
          ? {
              provider: completed.runtime.provider,
              model: completed.runtime.model,
            }
          : {}),
        ...(completed.error ? { failure_code: completed.error.code } : {}),
      },
    );
  }

  private reportCompletionPersistenceFailure(
    receipt: ReturnType<typeof createRuntimeExecutionReceipt>,
  ): void {
    this.logger.log('error', 'run.completion_persistence_failed', {
      run_id: receipt.runId,
      task_id: receipt.taskId,
      terminal_status: receipt.terminalStatus,
      provider: receipt.provider,
      model: receipt.model,
      result_available: receipt.resultAvailable,
      result_fingerprint: receipt.resultFingerprint,
      completed_at: receipt.completedAt,
    });
  }

  private async executeAgentRun(
    claim: ClaimedRun,
    ownerScope: InvokableOwnerScope,
    invokableVersionId: string,
    task: import('../../domain/tasks/task.js').Task,
  ) {
    const prompt = await this.resolveAgentPrompt(
      claim.run.prompt,
      ownerScope,
      invokableVersionId,
      task,
    );
    const execution = await this.runtime.execute({
      runId: claim.run.id,
      prompt,
    });
    for (const candidate of execution.memoryCandidates ?? []) {
      await this.createMemoryProposal?.execute({
        content: candidate.content,
        category: candidate.category,
        sourceTaskId: task.id,
        ...(task.sessionId ? { sourceSessionId: task.sessionId } : {}),
        accessContext: {
          tenantId: task.tenantId,
          serviceAccountId: task.principalId,
          workspaceId: task.workspaceId,
          principalType: task.principalType as 'service_account',
          principalId: task.principalId,
          policySnapshotVersion: task.policySnapshotVersion,
        },
      });
    }
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
    await this.events?.append(claim.run.id, 'output', { text: execution.text });

    return succeeded;
  }

  private async resolveAgentPrompt(
    prompt: string,
    ownerScope: InvokableOwnerScope,
    invokableVersionId: string,
    task: import('../../domain/tasks/task.js').Task,
  ): Promise<string> {
    if (invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID) {
      return prompt;
    }

    const agentVersion = await this.resolver.resolvePublished(
      invokableVersionId,
      ownerScope,
    );

    if (!agentVersion) {
      throw new Error(
        `Published agent version ${invokableVersionId} could not be loaded for execution`,
      );
    }

    let memory: string | null = null;
    if (task.memorySnapshotId && task.memorySnapshotHash) {
      if (!this.fileStore)
        throw new Error('Pinned memory projection is unavailable');
      memory = await this.fileStore.readVerified({
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
        snapshotId: task.memorySnapshotId,
        expectedContentHash: task.memorySnapshotHash,
      });
    }
    return assembleContext({
      instructions: agentVersion.instructions,
      taskInput: prompt,
      memory,
    });
  }
}
