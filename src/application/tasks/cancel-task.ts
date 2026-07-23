import type { AccessContext } from '../control-plane/access-context.js';
import type { AgentRuntimePort } from '../ports/agent-runtime.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { transitionRun } from '../../domain/runs/run.js';
import { transitionTask } from '../../domain/tasks/task.js';
export class CancelTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly runtime: AgentRuntimePort,
    private readonly events?: RunEventRepository,
  ) {}
  async execute(taskId: string, owner: AccessContext) {
    const record = await this.tasks.findByIdForOwner(taskId, owner);
    if (!record) return null;
    const task = record.task,
      run = await this.runs.findByTaskId(taskId);
    if (!run) return null;
    if (this.tasks.requestCancellation)
      await this.tasks.requestCancellation(taskId, new Date().toISOString());
    if (run.status === 'running') {
      await this.runtime.cancel?.({ runId: run.id });
      return {
        taskId,
        runId: run.id,
        status: 'cancellation_requested' as const,
      };
    }
    if (run.status === 'queued') {
      const now = new Date();
      const cancelled = transitionRun(
        run,
        'cancelled',
        { error: { code: 'cancelled', message: 'The run was cancelled.' } },
        () => now,
      );
      await this.runs.save(cancelled);
      if (!['completed', 'failed', 'cancelled'].includes(task.status))
        await this.tasks.save(transitionTask(task, 'cancelled', () => now));
      await this.events?.append(run.id, 'cancelled', { code: 'cancelled' });
      await this.tasks.advanceSessionLane?.(taskId);
      return { taskId, runId: run.id, status: 'cancelled' as const };
    }
    return { taskId, runId: run.id, status: 'terminal' as const };
  }
}
