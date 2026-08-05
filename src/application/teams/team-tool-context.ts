import { createHash } from 'node:crypto';
import type { RuntimeToolGrant } from '../extensions/runtime-tool-grant-service.js';
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
import { TeamPolicyEvaluator } from './team-policy-evaluator.js';

export type TeamToolContext = Readonly<{
  owner: OwnerScope;
  teamRun: TeamRun;
  member: TeamMemberRun;
  task: Task;
  run: Run;
  attempt: TeamWorkItemAttempt | null;
  grant: RuntimeToolGrant;
  allowedTools: readonly string[];
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

export class TeamToolContextResolver {
  public constructor(
    private readonly teams: TeamExecutionRepository,
    private readonly tasks: Pick<
      TaskRepository,
      'findByIdForOwner' | 'findByRootTaskIdForOwner'
    >,
    private readonly runs: Pick<RunRepository, 'findByIdForOwner'>,
    private readonly policy = new TeamPolicyEvaluator(),
  ) {}

  public async resolve(grant: RuntimeToolGrant): Promise<TeamToolContext> {
    if (!grant.teamMemberRunId || !grant.taskId || !grant.runId)
      throw new TeamContextError('not_allowed');
    const owner = {
      tenantId: grant.tenantId,
      workspaceId: grant.workspaceId,
      principalType: grant.principalType,
      principalId: grant.principalId,
    };
    const member = await this.teams.findMemberRunById(
      grant.teamMemberRunId,
      owner,
    );
    const taskRecord = await this.tasks.findByIdForOwner(grant.taskId, owner);
    const run = await this.runs.findByIdForOwner(grant.runId, owner);
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
      currentRun.runId !== grant.runId ||
      currentRun.status !== run.status ||
      terminalRunStatuses.has(run.status) ||
      terminalTaskStatuses.has(task.status) ||
      member.status === 'stopped' ||
      member.status === 'failed' ||
      grant.contextEpoch !== deriveTeamContextEpoch(task.id, run.id)
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
    const context = Object.freeze({
      owner,
      teamRun,
      member,
      task,
      run,
      attempt: attempt ?? null,
      grant,
      allowedTools: grant.allowedTools,
      contextEpoch: deriveTeamContextEpoch(task.id, run.id),
    });
    return Object.freeze({
      ...context,
      allowedTools: this.policy.evaluate(context).allowedTools,
    });
  }
}

export function deriveTeamContextEpoch(taskId: string, runId: string): string {
  return createHash('sha256')
    .update(`${taskId}:${runId}`)
    .digest('hex')
    .slice(0, 24);
}
