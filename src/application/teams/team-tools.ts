import { createTeamWorkItem } from '../../domain/teams/team-work-item.js';
import { normalizeTeamRunFinalText } from '../../domain/teams/team-run.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../ports/team-execution-repository.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';

export interface TeamToolActor extends OwnerScope {
  readonly memberId: string;
  readonly role: 'lead' | 'member';
  readonly teamRunId: string;
}

export class TeamToolHandler {
  public constructor(
    private readonly repo: TeamExecutionRepository,
    private readonly runs: RunRepository,
    private readonly tasks: TaskRepository,
    private readonly events?: RunEventRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async actorForMemberRun(
    memberId: string,
    owner: OwnerScope,
  ): Promise<TeamToolActor | null> {
    const member = await this.repo.findMemberRunById(memberId, owner);
    if (!member) return null;
    const teamRun = await this.repo.findTeamRunById(member.teamRunId, owner);
    if (!teamRun) return null;
    return {
      ...owner,
      memberId: member.id,
      role: member.role,
      teamRunId: member.teamRunId,
    };
  }

  public async team_members_list(teamRunId: string, actor: TeamToolActor) {
    await this.team(teamRunId, actor);
    return this.repo.findMembersByTeamRunId(teamRunId, actor);
  }
  public async team_task_create(
    teamRunId: string,
    subject: string,
    description: string | undefined,
    actor: TeamToolActor,
  ) {
    const team = await this.team(teamRunId, actor);
    const item = createTeamWorkItem({
      teamRunId,
      subject,
      ...(description === undefined ? {} : { description }),
      createdByMemberId: actor.memberId,
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      now: this.now,
    });
    await this.repo.createWorkItem(item);
    return item;
  }
  public async team_task_list(teamRunId: string, actor: TeamToolActor) {
    await this.team(teamRunId, actor);
    return this.repo.findWorkItemsByTeamRunId(teamRunId, actor);
  }
  public async team_task_claim(
    teamRunId: string,
    workItemId: string,
    actor: TeamToolActor,
  ) {
    await this.team(teamRunId, actor);
    return this.repo.atomicClaimWorkItem(
      workItemId,
      actor.memberId,
      teamRunId,
      actor,
    );
  }
  public async team_task_update(
    teamRunId: string,
    workItemId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled',
    completionSummary: string | undefined,
    actor: TeamToolActor,
  ) {
    await this.team(teamRunId, actor);
    if (actor.teamRunId !== teamRunId) throw new Error('Team run not found.');
    return this.repo.updateWorkItemStatus(
      workItemId,
      status,
      completionSummary ?? null,
      actor,
    );
  }
  public async team_complete(
    teamRunId: string,
    finalText: string,
    actor: TeamToolActor,
  ) {
    if (actor.role !== 'lead')
      throw new Error('Only the team lead can complete a team.');
    const team = await this.team(teamRunId, actor);
    if (team.phase !== 'lead_finalize')
      throw new Error('Team can only be completed during lead_finalize.');
    const items = await this.repo.findWorkItemsByTeamRunId(teamRunId, actor);
    if (items.some((item) => item.status !== 'completed'))
      throw new Error('Team has unfinished work items.');
    const normalizedFinalText = normalizeTeamRunFinalText(finalText);
    return this.repo.completeTeamRunAtomically({
      teamRunId,
      rootRunId: team.rootRunId,
      rootTaskId: team.rootTaskId,
      finalText: normalizedFinalText,
      owner: actor,
      updatedAt: this.now().toISOString(),
    });
  }

  public async team_work_create_and_assign(input: { teamRunId: string; subject: string; description?: string; assigneeMemberId: string; sourceRunId: string; leadTaskId: string; commandHash: string; expectedRevision: number }, actor: TeamToolActor) {
    if (actor.role !== 'lead') throw new Error('Only the team lead can assign work.');
    await this.team(input.teamRunId, actor);
    return this.repo.createAssignedWork({ ...input, description: input.description ?? null, owner: actor });
  }
  public async team_work_accept(input: { teamRunId: string; workItemId: string; sourceRunId: string; commandHash: string; expectedRevision: number }, actor: TeamToolActor) {
    if (actor.role !== 'lead') throw new Error('Only the team lead can accept work.');
    return this.repo.acceptWork({ ...input, owner: actor });
  }
  public async team_work_request_rework(input: { teamRunId: string; workItemId: string; assigneeMemberId: string; feedback: string; sourceRunId: string; leadTaskId: string; commandHash: string; expectedRevision: number }, actor: TeamToolActor) {
    if (actor.role !== 'lead') throw new Error('Only the team lead can request rework.');
    return this.repo.requestRework({ ...input, owner: actor });
  }
  public async team_completion_request(input: { teamRunId: string; sourceRunId: string; commandHash: string; expectedRevision: number }, actor: TeamToolActor) {
    if (actor.role !== 'lead') throw new Error('Only the team lead can request completion.');
    return this.repo.requestCompletion({ ...input, owner: actor });
  }
  private async team(id: string, actor: OwnerScope) {
    if ('teamRunId' in actor && actor.teamRunId !== id)
      throw new Error('Team run not found.');
    const team = await this.repo.findTeamRunById(id, actor);
    if (!team) throw new Error('Team run not found.');
    return team;
  }
}
