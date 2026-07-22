import type { Task } from '../../domain/tasks/task.js';
import type {
  RunFailure,
  RunResult,
  RunRuntime,
} from '../../domain/runs/run.js';
import type { RunStatus } from '../../domain/runs/run-status.js';

export interface TaskOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export interface TaskLatestRunSummary {
  readonly runId: string;
  readonly attempt: number;
  readonly status: RunStatus;
  readonly runtime: RunRuntime | null;
  readonly result: RunResult | null;
  readonly error: RunFailure | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskRecord {
  readonly task: Task;
  readonly latestRun: TaskLatestRunSummary | null;
}

export interface TaskRepository {
  save(task: Task): Promise<void>;
  findById(id: string): Promise<Task | null>;
  findByIdForOwner(
    id: string,
    ownerScope: TaskOwnerScope,
  ): Promise<TaskRecord | null>;
  findByRootTaskIdForOwner(
    rootTaskId: string,
    ownerScope: TaskOwnerScope,
  ): Promise<readonly TaskRecord[]>;
}
