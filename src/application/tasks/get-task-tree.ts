import type { AccessContext } from '../../platform/access-context.js';
import type {
  TaskOwnerScope,
  TaskRecord,
  TaskRepository,
} from '../ports/task-repository.js';

export class GetTaskTree {
  public constructor(private readonly repository: TaskRepository) {}

  public async execute(
    id: string,
    accessContext: AccessContext,
  ): Promise<readonly TaskRecord[] | null> {
    const ownerScope = toTaskOwnerScope(accessContext);
    const task = await this.repository.findByIdForOwner(id, ownerScope);

    if (!task) {
      return null;
    }

    return this.repository.findByRootTaskIdForOwner(
      task.task.rootTaskId,
      ownerScope,
    );
  }
}

function toTaskOwnerScope(accessContext: AccessContext): TaskOwnerScope {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}
