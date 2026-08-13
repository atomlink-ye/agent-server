import type { AccessContext } from '../../platform/access-context.js';
import type { Run } from '../../domain/runs/run.js';
import type { RunOwnerScope, RunRepository } from '../ports/run-repository.js';

export class GetRun {
  public constructor(private readonly repository: RunRepository) {}

  public execute(
    id: string,
    accessContext: AccessContext,
  ): Promise<Run | null> {
    return this.repository.findByIdForOwner(id, toRunOwnerScope(accessContext));
  }
}

function toRunOwnerScope(accessContext: AccessContext): RunOwnerScope {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}
