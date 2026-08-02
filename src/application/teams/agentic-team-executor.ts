import type { Run } from '../../domain/runs/run.js';
import type { Task } from '../../domain/tasks/task.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';

export class AgenticTeamExecutor {
  public constructor(private readonly executions: TeamExecutionRepository) {}
  public async handleTerminalRun(input: { team: TeamRun; task: Task; run: Run }): Promise<void> {
    if (input.team.executionMode !== 'agentic_mve') return;
    if (input.team.leadTurnCount >= 4) throw new Error('Agentic Team stopped: lead_turn_limit.');
    if (input.task.teamTaskKind !== 'lead_turn' && input.task.teamTaskKind !== 'work_attempt') throw new Error('Agentic Team child task is missing explicit task kind.');
    void input.run; void this.executions;
  }
}
