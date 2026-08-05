import type { Run } from '../../domain/runs/run.js';
import type { Task } from '../../domain/tasks/task.js';
import type { ClaimedRun } from '../ports/run-repository.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import { TeamDriver } from '../teams/team-driver.js';

export interface ExecuteTeamTaskInput {
  readonly claim: ClaimedRun;
  readonly task: Task;
}

export class ExecuteTeamTask {
  public constructor(
    private readonly invokables: InvokableRepository,
    private readonly teamDriver: TeamDriver,
  ) {}

  public async execute(input: ExecuteTeamTaskInput): Promise<Run> {
    const teamVersion = await this.invokables.findPublishedTeamVersionById(
      input.task.invokableVersionId,
      {
        tenantId: input.task.tenantId,
        workspaceId: input.task.workspaceId,
        principalType: input.task.principalType,
        principalId: input.task.principalId,
      },
    );
    if (!teamVersion)
      throw new Error(
        'Published team version could not be loaded for execution',
      );
    return this.teamDriver.activateTeamRun(
      teamVersion,
      input.claim,
      input.task,
    );
  }
}
