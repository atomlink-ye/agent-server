import { transitionRun, type RunFailure } from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { transitionTask } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
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
import {
  buildPublishedAgentPrompt,
  ExecuteTeamTask,
} from '../tasks/execute-team-task.js';
import { CompleteRun } from './complete-run.js';

export class ExecuteRun {
  public constructor(
    private readonly completeRun: CompleteRun,
    private readonly tasks: TaskRepository,
    private readonly invokables: InvokableRepository,
    private readonly executeTeamTask: ExecuteTeamTask,
    private readonly runtime: AgentRuntimePort,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
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

    try {
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

      const completed =
        task.invokableKind === 'team'
          ? await this.completeRun.execute({
              claim,
              run: await this.executeTeamTask.execute({ claim, task }),
            })
          : await this.executeAgentRun(
              claim,
              {
                tenantId: task.tenantId,
                workspaceId: task.workspaceId,
                principalType: task.principalType,
                principalId: task.principalId,
              },
              task.invokableVersionId,
            );

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
      return completed;
    } catch (error) {
      const timedOut = error instanceof RuntimeTimedOutError;
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
      const completed = await this.completeRun.execute({ claim, run: failed });
      this.logger.log('error', 'run.failed', {
        run_id: claim.run.id,
        failure_code: failure.code,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return completed;
    }
  }

  private async executeAgentRun(
    claim: ClaimedRun,
    ownerScope: InvokableOwnerScope,
    invokableVersionId: string,
  ) {
    const prompt = await this.resolveAgentPrompt(
      claim.run.prompt,
      ownerScope,
      invokableVersionId,
    );
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

    return this.completeRun.execute({
      claim,
      run: succeeded,
    });
  }

  private async resolveAgentPrompt(
    prompt: string,
    ownerScope: InvokableOwnerScope,
    invokableVersionId: string,
  ): Promise<string> {
    if (invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID) {
      return prompt;
    }

    const agentVersion = await this.invokables.findPublishedAgentVersionById(
      invokableVersionId,
      ownerScope,
    );

    if (!agentVersion) {
      throw new Error(
        `Published agent version ${invokableVersionId} could not be loaded for execution`,
      );
    }

    return buildPublishedAgentPrompt(agentVersion.instructions, prompt);
  }
}
