import type { InvokeTaskRequest } from '../tasks/invoke-task.js';

/** The Work boundary's narrow adapter over technical Task admission. */
export interface ExecutionAdmission {
  admitRoot(request: InvokeTaskRequest): Promise<{
    readonly taskId: string;
    readonly reused: boolean;
  }>;
}

export class InvokeTaskExecutionAdmission implements ExecutionAdmission {
  public constructor(
    private readonly invokeTask: {
      execute(request: InvokeTaskRequest): Promise<{
        readonly task: { readonly task: { readonly id: string } };
        readonly reused: boolean;
      }>;
    },
  ) {}

  public async admitRoot(request: InvokeTaskRequest) {
    const result = await this.invokeTask.execute(request);
    return { taskId: result.task.task.id, reused: result.reused };
  }
}
