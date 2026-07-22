import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import type { Run } from '../../domain/runs/run.js';
import { transitionTask } from '../../domain/tasks/task.js';
import { terminalTaskStatuses } from '../../domain/tasks/task-status.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';

export interface CompleteRunInput {
  readonly claim: ClaimedRun;
  readonly run: Run;
}

export class CompleteRun {
  public constructor(
    private readonly repository: RunRepository,
    private readonly tasks: TaskRepository,
  ) {}

  public async execute(input: CompleteRunInput): Promise<Run> {
    if (!terminalRunStatuses.has(input.run.status)) {
      throw new Error('Run completion requires a terminal run status');
    }

    const completedRun = await this.repository.completeClaimed(input);
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

    return completedRun;
  }
}
