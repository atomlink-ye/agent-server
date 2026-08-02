import type { Run } from '../../domain/runs/run.js';
import type { Task } from '../../domain/tasks/task.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import { CollaborativeTeamExecutor } from './collaborative-team-executor.js';

export class TeamPhaseCoordinator {
  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly executor: CollaborativeTeamExecutor,
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly admission: AdmissionRepository,
  ) {}
  public async execute(input: {
    readonly run: Run;
    readonly task: Task;
  }): Promise<void> {
    const owner = {
      tenantId: input.task.tenantId,
      workspaceId: input.task.workspaceId,
      principalType: input.task.principalType,
      principalId: input.task.principalId,
    };
    const team = await this.executions.findTeamRunByRootTaskId(
      input.task.rootTaskId,
      owner,
    );
    if (!team) return;
    if (
      team.phase === 'lead_kickoff' &&
      input.task.logicalStepKey?.includes(':kickoff') &&
      input.run.status === 'succeeded'
    )
      await this.executor.fanOutTeammateTurns(
        team,
        this.executions,
        this.tasks,
        this.runs,
        this.admission,
      );
    else if (
      team.phase === 'member_work' &&
      input.task.logicalStepKey?.includes(':member_work')
    )
      await this.executor.advanceAfterMemberCompletion(
        input.run,
        input.task,
        this.executions,
        this.tasks,
        this.runs,
        this.admission,
      );
    else if (
      team.phase === 'lead_finalize' &&
      input.task.logicalStepKey?.includes(':finalize') &&
      input.run.status === 'succeeded'
    )
      await this.executor.completeLeadFinalization({
        run: input.run,
        task: input.task,
        execution: this.executions,
      });
  }
}
