import { createHash } from 'node:crypto';
import type { AuthorizedRuntimeToolContext } from '../runtime/authorize-runtime-tool.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { Task } from '../../domain/tasks/task.js';
import type { Run } from '../../domain/runs/run.js';
import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import { terminalTaskStatuses } from '../../domain/tasks/task-status.js';

export type TeamToolContext = Readonly<{
  owner: OwnerScope;
  teamRun: TeamRun;
  member: TeamMemberRun;
  task: Task;
  run: Run;
  attempt: TeamWorkItemAttempt | null;
  grant: AuthorizedRuntimeToolContext;
  /** User/domain tools allowed in the current runtime turn. */
  domainTools: readonly string[];
  contextEpoch: string;
}>;

export class TeamContextError extends Error {
  public constructor(
    public readonly code:
      | 'invalid_request'
      | 'not_allowed'
      | 'not_found'
      | 'stale_state'
      | 'conflict'
      | 'invalid_transition'
      | 'limit_exceeded'
      | 'team_terminal' = 'not_found',
  ) {
    super(code);
    this.name = 'TeamContextError';
  }
}

/**
 * Resolve the authenticated runtime bearer to the current durable Team turn.
 * Tool visibility is not an authorization input: every call re-reads the
 * participant, Task, Run and Team state and validates the active-turn epoch.
 */
export class TeamToolContextResolver {
  public constructor(
    private readonly teams: TeamExecutionRepository,
    private readonly tasks: Pick<
      TaskRepository,
      'findByIdForOwner' | 'findByRootTaskIdForOwner'
    >,
    private readonly runs: Pick<RunRepository, 'findByIdForOwner'>,
  ) {}

  public async resolve(
    grant: AuthorizedRuntimeToolContext,
  ): Promise<TeamToolContext> {
    if (!grant.teamMemberRunId) throw new TeamContextError('not_allowed');
    const activeTurn = grant.activeTurn;
    if (!activeTurn) throw new TeamContextError('stale_state');

    const owner = {
      tenantId: grant.tenantId,
      workspaceId: grant.workspaceId,
      principalType: grant.principalType,
      principalId: grant.principalId,
    };
    const [member, taskRecord, run] = await Promise.all([
      this.teams.findMemberRunById(grant.teamMemberRunId, owner),
      this.tasks.findByIdForOwner(activeTurn.taskId, owner),
      this.runs.findByIdForOwner(activeTurn.runId, owner),
    ]);
    const task = taskRecord?.task;
    if (!member || !taskRecord || !task || !run)
      throw new TeamContextError('not_found');

    const teamRun = await this.teams.findTeamRunById(member.teamRunId, owner);
    const currentRun = taskRecord.latestRun;
    if (
      !teamRun ||
      task.teamMemberRunId !== member.id ||
      task.rootTaskId !== teamRun.rootTaskId ||
      !currentRun ||
      currentRun.runId !== run.id ||
      currentRun.runId !== activeTurn.runId ||
      currentRun.status !== run.status ||
      terminalRunStatuses.has(run.status) ||
      terminalTaskStatuses.has(task.status) ||
      member.status === 'stopped' ||
      member.status === 'failed' ||
      activeTurn.contextEpoch !== deriveTeamContextEpoch(task.id, run.id)
    )
      throw new TeamContextError('stale_state');
    if (teamRun.status !== 'active' && teamRun.status !== 'waiting')
      throw new TeamContextError('not_allowed');

    const attempt =
      task.teamTaskKind === 'work_attempt'
        ? (await this.teams.findAttemptsByTeamRunId(teamRun.id, owner)).find(
            (candidate) =>
              candidate.executionTaskId === task.id &&
              candidate.assigneeMemberId === member.id,
          )
        : null;
    if (task.teamTaskKind === 'work_attempt' && !attempt)
      throw new TeamContextError('stale_state');

    const records = await this.tasks.findByRootTaskIdForOwner(
      teamRun.rootTaskId,
      owner,
    );
    const otherActiveTask = records.some(
      (record) =>
        record.task.teamMemberRunId === member.id &&
        record.task.id !== task.id &&
        record.latestRun !== null &&
        !terminalRunStatuses.has(record.latestRun.status),
    );
    if (otherActiveTask) throw new TeamContextError('conflict');

    return Object.freeze({
      owner,
      teamRun,
      member,
      task,
      run,
      attempt: attempt ?? null,
      grant,
      domainTools: grant.allowedTools,
      contextEpoch: deriveTeamContextEpoch(task.id, run.id),
    });
  }
}

export function deriveTeamContextEpoch(taskId: string, runId: string): string {
  return createHash('sha256')
    .update(`${taskId}:${runId}`)
    .digest('hex')
    .slice(0, 24);
}
