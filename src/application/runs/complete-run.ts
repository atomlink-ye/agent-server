import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import type { Run } from '../../domain/runs/run.js';
import { transitionTask } from '../../domain/tasks/task.js';
import { terminalTaskStatuses } from '../../domain/tasks/task-status.js';
import {
  RunCompletionConflictError,
  type ClaimedRun,
  type RunRepository,
} from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { Task } from '../../domain/tasks/task.js';
import type { AdvanceTeamExecution } from '../tasks/advance-team-execution.js';
import type { TeamPhaseCoordinator } from '../teams/team-phase-coordinator.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
  RunPostPersistenceError,
  safePostPersistenceErrorName,
  type RunPostPersistenceStage,
} from './runtime-execution-receipt.js';

export interface CompleteRunInput {
  readonly claim: ClaimedRun;
  readonly run: Run;
}

export class CompleteRun {
  public constructor(
    private readonly repository: RunRepository,
    private readonly tasks: TaskRepository,
    private readonly events?: RunEventRepository,
    private readonly sessions?: SessionRepository,
    private readonly completionNotifier?: {
      notifySucceeded(input: {
        readonly run: Run;
        readonly task: Task;
      }): Promise<void>;
    },
    private readonly advanceTeamExecution?: AdvanceTeamExecution,
    private readonly teamPhaseCoordinator?: TeamPhaseCoordinator,
  ) {}

  public async execute(input: CompleteRunInput): Promise<Run> {
    if (!terminalRunStatuses.has(input.run.status)) {
      throw new Error('Run completion requires a terminal run status');
    }

    let completedRun: Run;
    try {
      completedRun = await this.repository.completeClaimed(input);
    } catch (error) {
      if (error instanceof RunCompletionConflictError) throw error;
      throw new RunCompletionPersistenceError(
        createRuntimeExecutionReceipt(input.run, input.claim.taskId),
      );
    }
    const task = await this.postPersistence(
      completedRun,
      input.claim.taskId,
      'task_reload',
      () => this.tasks.findById(input.claim.taskId),
    );

    if (!task) {
      throw this.postPersistenceError(
        completedRun,
        input.claim.taskId,
        'task_reload',
        'TaskNotFoundError',
      );
    }

    if (completedRun.status === 'succeeded') {
      await this.postPersistence(
        completedRun,
        input.claim.taskId,
        'completion_notifier',
        () =>
          this.completionNotifier?.notifySucceeded({
            run: completedRun,
            task,
          }),
      );
    }

    if (!terminalTaskStatuses.has(task.status)) {
      const terminalStatus =
        completedRun.status === 'succeeded'
          ? 'completed'
          : completedRun.status === 'cancelled'
            ? 'cancelled'
            : 'failed';
      const timestamp = new Date(completedRun.updatedAt);
      const activeTask =
        task.status === 'queued'
          ? transitionTask(task, 'active', () => timestamp)
          : task;

      await this.postPersistence(
        completedRun,
        input.claim.taskId,
        'task_projection',
        () =>
          this.tasks.save(
            transitionTask(activeTask, terminalStatus, () => timestamp),
          ),
      );
    }

    await this.postPersistence(
      completedRun,
      input.claim.taskId,
      'team_execution',
      () => this.advanceTeamExecution?.execute(input),
    );
    await this.postPersistence(
      completedRun,
      input.claim.taskId,
      'team_phase',
      () => this.teamPhaseCoordinator?.execute({ run: completedRun, task }),
    );

    const sessions = this.sessions;
    if (
      completedRun.status === 'succeeded' &&
      completedRun.result != null &&
      sessions?.appendAssistantMessage &&
      task.sessionId != null &&
      task.generation != null
    ) {
      const appendAssistantMessage =
        sessions.appendAssistantMessage.bind(sessions);
      const result = completedRun.result;
      const sessionId = task.sessionId;
      const generation = task.generation;
      await this.postPersistence(
        completedRun,
        input.claim.taskId,
        'assistant_message',
        () =>
          appendAssistantMessage({
            sessionId,
            generation,
            taskId: task.id,
            runId: completedRun.id,
            text: result.text,
          }),
      );
    }

    await this.postPersistence(
      completedRun,
      input.claim.taskId,
      'session_lane',
      () => this.tasks.advanceSessionLane?.(input.claim.taskId),
    );
    if (
      this.events &&
      completedRun.status === 'succeeded' &&
      completedRun.result
    ) {
      await this.postPersistence(
        completedRun,
        input.claim.taskId,
        'run_output_event',
        () =>
          this.events!.append(completedRun.id, 'output', {
            text: completedRun.result!.text,
          }),
      );
    }
    if (this.events) {
      await this.postPersistence(
        completedRun,
        input.claim.taskId,
        'run_terminal_event',
        () =>
          this.events!.append(
            completedRun.id,
            completedRun.status === 'succeeded'
              ? 'succeeded'
              : completedRun.status === 'cancelled'
                ? 'cancelled'
                : 'failed',
            completedRun.error ? { code: completedRun.error.code } : {},
          ),
      );
    }

    return completedRun;
  }

  private async postPersistence<T>(
    completedRun: Run,
    taskId: string,
    stage: RunPostPersistenceStage,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.postPersistenceError(
        completedRun,
        taskId,
        stage,
        safePostPersistenceErrorName(error),
      );
    }
  }

  private postPersistenceError(
    completedRun: Run,
    taskId: string,
    stage: RunPostPersistenceStage,
    errorName: string,
  ): RunPostPersistenceError {
    return new RunPostPersistenceError({
      runId: completedRun.id,
      taskId,
      terminalStatus: completedRun.status as Extract<
        Run['status'],
        'succeeded' | 'failed' | 'timed_out' | 'cancelled'
      >,
      stage,
      errorName,
    });
  }
}
