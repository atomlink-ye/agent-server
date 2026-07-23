import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import type { Run } from '../../domain/runs/run.js';
import { transitionTask } from '../../domain/tasks/task.js';
import { terminalTaskStatuses } from '../../domain/tasks/task-status.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { SessionRepository } from '../ports/session-repository.js';

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
  ) {}

  public async execute(input: CompleteRunInput): Promise<Run> {
    if (!terminalRunStatuses.has(input.run.status)) {
      throw new Error('Run completion requires a terminal run status');
    }

    const completedRun = await this.repository.completeClaimed(input);
    if (this.events) {
      await this.events.append(
        input.claim.run.id,
        completedRun.status === 'succeeded'
          ? 'succeeded'
          : completedRun.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
        completedRun.error ? { code: completedRun.error.code } : {},
      );
    }
    const task = await this.tasks.findById(input.claim.taskId);

    if (!task) {
      throw new Error('Completed run task could not be reloaded');
    }

    if (!terminalTaskStatuses.has(task.status)) {
      const terminalStatus =
        completedRun.status === 'succeeded' ? 'completed' : 'failed';
      const timestamp = new Date(completedRun.updatedAt);
      const activeTask =
        task.status === 'queued'
          ? transitionTask(task, 'active', () => timestamp)
          : task;

      await this.tasks.save(
        transitionTask(activeTask, terminalStatus, () => timestamp),
      );
    }

    await this.tasks.advanceSessionLane?.(input.claim.taskId);
    if (
      completedRun.status === 'succeeded' &&
      completedRun.result &&
      this.sessions &&
      task.sessionId &&
      task.generation !== null &&
      task.generation !== undefined &&
      this.sessions.appendAssistantMessage
    ) {
      await this.sessions.appendAssistantMessage({
        sessionId: task.sessionId,
        generation: task.generation,
        taskId: task.id,
        runId: completedRun.id,
        text: completedRun.result.text,
      });
    }

    return completedRun;
  }
}
