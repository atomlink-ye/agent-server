import type { Task } from '../../domain/tasks/task.js';

export interface TaskRepository {
  save(task: Task): Promise<void>;
}
