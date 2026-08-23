import type { AccessContext } from '../../domain/access-context.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { transitionTask } from '../../domain/tasks/task.js';

export interface ActiveExecutionCanceller {
  cancelRun(input: { readonly runId: string }): Promise<void>;
}

export class CancelTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly executions: ActiveExecutionCanceller,
    private readonly events?: RunEventRepository,
  ) {}

  async execute(taskId: string, owner: AccessContext) {
    const record = await this.tasks.findByIdForOwner(taskId, owner);
    if (!record) return null;
    const task = record.task;
    const run = await this.runs.findByTaskId(taskId);
    if (!run) return null;
    const cancellation = await this.runs.requestCancellation(
      taskId,
      new Date().toISOString(),
    );
    if (!cancellation) return null;
    const { runId, outcome } = cancellation;
    if (outcome === 'running_requested') {
      await this.executions.cancelRun({ runId });
      return {
        taskId,
        runId,
        status: 'cancellation_requested' as const,
      };
    }
    if (outcome === 'running_already_requested') {
      return {
        taskId,
        runId,
        status: 'cancellation_requested' as const,
      };
    }
    if (outcome === 'queued_cancelled') {
      const now = new Date();
      if (!['completed', 'failed', 'cancelled'].includes(task.status))
        await this.tasks.save(transitionTask(task, 'cancelled', () => now));
      await this.tasks.advanceSessionLane?.(taskId);
      await this.events?.append(runId, 'cancelled', { code: 'cancelled' });
      return { taskId, runId, status: 'cancelled' as const };
    }
    return { taskId, runId, status: 'terminal' as const };
  }
}
