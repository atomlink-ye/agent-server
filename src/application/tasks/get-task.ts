import type { AccessContext } from '../control-plane/access-context.js';
import type {
  TaskOwnerScope,
  TaskRecord,
  TaskRepository,
} from '../ports/task-repository.js';

export class GetTask {
  public constructor(private readonly repository: TaskRepository) {}

  public execute(
    id: string,
    accessContext: AccessContext,
  ): Promise<TaskRecord | null> {
    return this.repository.findByIdForOwner(
      id,
      toTaskOwnerScope(accessContext),
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
