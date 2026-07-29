import { createChildTask, type Task } from '../../domain/tasks/task.js';
import { createRun, transitionRun, type Run } from '../../domain/runs/run.js';
import { createTeamRun, type TeamRun } from '../../domain/teams/team-run.js';
import {
  createTeamMemberRun,
  activateMemberRun,
  type TeamMemberRun,
} from '../../domain/teams/team-member-run.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../ports/team-execution-repository.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import type { RuntimeSessionRepository } from '../ports/runtime-session-repository.js';

export class CollaborativeTeamExecutor {
  public constructor(
    private readonly teamExecutions: TeamExecutionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async activateTeamRun(
    teamVersion: TeamVersion,
    rootClaim: ClaimedRun,
    rootTask: Task,
    invokables: InvokableRepository,
    execution: RunRepository,
    runtimeSessions: RuntimeSessionRepository | undefined,
    tasks: TaskRepository,
    admission: AdmissionRepository,
  ): Promise<Run> {
    const spec = teamVersion.collaborationSpec;
    if (!spec)
      throw new Error('Collaborative team version has no collaboration spec.');
    const owner = ownerOf(rootTask);
    const teamRun = createTeamRun({
      ...owner,
      rootTaskId: rootTask.rootTaskId,
      rootRunId: rootClaim.run.id,
      teamVersionId: teamVersion.id,
      environmentVersionId: spec.environmentVersionId,
      now: this.now,
    });
    const lead = createTeamMemberRun({
      ...owner,
      teamRunId: teamRun.id,
      name: spec.lead.name,
      role: 'lead',
      agentVersionId: spec.lead.agentVersionId,
      now: this.now,
    });
    const members = spec.roster.map((member) =>
      createTeamMemberRun({
        ...owner,
        teamRunId: teamRun.id,
        name: member.name,
        role: 'member',
        agentVersionId: member.agentVersionId,
        now: this.now,
      }),
    );
    const leadTask = this.child(
      rootTask,
      rootClaim.run,
      lead,
      `lead:${teamRun.id}:${lead.id}:kickoff`,
      `team_run_id: ${teamRun.id}\n\nYou are the lead. Create exactly two work items with team_task_create for the researcher and critic. Then stop without finalizing; teammates will run next.\n\nOriginal request: ${rootClaim.run.prompt}`,
      lead.agentVersionId,
    );
    const leadRun = createRun(rootClaim.run.prompt, { now: this.now });
    let waitingRootRun: Run | null = null;
    await this.teamExecutions.createTeamRun(teamRun);
    await this.teamExecutions.createMemberRun(
      activateMemberRun(lead, this.now),
    );
    for (const member of members)
      await this.teamExecutions.createMemberRun(member);
    await admission.withTransaction(async (tx) => {
      await tx.tasks.save(leadTask);
      await tx.runs.save(leadRun, { taskId: leadTask.id, attempt: 1 });
      await tx.enqueueRunDispatch(leadRun.id, leadRun.createdAt);
      if (!execution.releaseClaimedToWaiting)
        throw new Error('Waiting Run persistence is unavailable.');
      waitingRootRun = await execution.releaseClaimedToWaiting(rootClaim);
    });
    void invokables;
    void runtimeSessions;
    return (
      waitingRootRun ??
      transitionRun(rootClaim.run, 'waiting_children', {}, this.now)
    );
  }

  public async fanOutTeammateTurns(
    teamRun: TeamRun,
    execution: TeamExecutionRepository,
    tasks: TaskRepository,
    runs: RunRepository,
    admission: AdmissionRepository,
  ): Promise<void> {
    if (teamRun.phase !== 'lead_kickoff') return;
    const owner = ownerOfTeam(teamRun);
    const members = (
      await execution.findMembersByTeamRunId(teamRun.id, owner)
    ).filter((m) => m.role === 'member');
    const existing = await tasks.findByRootTaskIdForOwner(
      teamRun.rootTaskId,
      owner,
    );
    if (
      existing.some((r) =>
        r.task.logicalStepKey?.startsWith(`team:${teamRun.id}:member:`),
      )
    )
      return;
    const root = await tasks.findById(teamRun.rootTaskId);
    if (!root) throw new Error('Team root task not found.');
    const records = members.map((member) => {
      const task = this.child(
        root,
        { id: teamRun.rootRunId, prompt: root.inputSnapshotRef } as Run,
        member,
        `member:${teamRun.id}:${member.id}:member_work`,
        `team_run_id: ${teamRun.id}\n\nYou are ${member.name}. Use team_task_list to find a pending work item, claim one with team_task_claim, then complete it with team_task_update using status completed and a concise completion_summary. Do not inspect repository files.`,
        member.agentVersionId,
      );
      return {
        task,
        run: createRun(`Work for ${member.name}`, { now: this.now }),
      };
    });
    await admission.withTransaction(async (tx) => {
      if (!tx.teamExecutions)
        throw new Error(
          'Team execution transaction persistence is unavailable.',
        );
      const advanced = await tx.teamExecutions.updateTeamRunPhaseIfCurrent(
        teamRun.id,
        'member_work',
        owner,
        'lead_kickoff',
      );
      if (!advanced) return;
      for (const r of records) {
        await tx.tasks.save(r.task);
        await tx.runs.save(r.run, { taskId: r.task.id, attempt: 1 });
        await tx.enqueueRunDispatch(r.run.id, r.run.createdAt);
      }
    });
  }

  public async advanceAfterMemberCompletion(
    completed: Run,
    task: Task,
    execution: TeamExecutionRepository,
    tasks: TaskRepository,
    runs: RunRepository,
    admission: AdmissionRepository,
  ): Promise<void> {
    void runs;
    if (!task?.logicalStepKey) return;
    const teamRun = await execution.findTeamRunByRootTaskId(
      task.rootTaskId,
      ownerOf(task),
    );
    if (!teamRun || teamRun.phase !== 'member_work') return;
    const items = await execution.findWorkItemsByTeamRunId(
      teamRun.id,
      ownerOfTeam(teamRun),
    );
    // Advance when all work items are completed, OR when all member tasks have
    // reached a terminal state (even if some work items were left pending due
    // to member failures).
    if (items.some((i) => i.status !== 'completed')) {
      const childTasks = await tasks.findByRootTaskIdForOwner(
        teamRun.rootTaskId,
        ownerOf(task),
      );
      const memberTasks = childTasks.filter((r) =>
        r.task.logicalStepKey?.includes(':member_work'),
      );
      if (memberTasks.length === 0) return;
      if (
        memberTasks.some(
          (r) => r.task.status === 'queued' || r.task.status === 'active',
        )
      )
        return;
    }
    const root = await tasks.findById(teamRun.rootTaskId);
    if (!root) throw new Error('Team root task not found.');
    const lead = (
      await execution.findMembersByTeamRunId(teamRun.id, ownerOfTeam(teamRun))
    ).find((m) => m.role === 'lead');
    if (!lead) throw new Error('Team lead not found.');
    const continuation = this.child(
      root,
      completed,
      lead,
      `lead:${teamRun.id}:${lead.id}:finalize`,
      `team_run_id: ${teamRun.id}\n\nUse team_task_list to review completed teammate work, then call team_complete with a concise final_text. Do not inspect repository files.`,
      lead.agentVersionId,
    );
    const run = createRun('Review teammate work and call team_complete.', {
      now: this.now,
    });
    await admission.withTransaction(async (tx) => {
      if (!tx.teamExecutions)
        throw new Error(
          'Team execution transaction persistence is unavailable.',
        );
      const advanced = await tx.teamExecutions.updateTeamRunPhaseIfCurrent(
        teamRun.id,
        'lead_finalize',
        ownerOfTeam(teamRun),
        'member_work',
      );
      if (!advanced) return;
      await tx.tasks.save(continuation);
      await tx.runs.save(run, { taskId: continuation.id, attempt: 1 });
      await tx.enqueueRunDispatch(run.id, run.createdAt);
    });
  }

  private child(
    parent: Task,
    parentRun: Run,
    member: TeamMemberRun,
    key: string,
    prompt: string,
    agentVersionId: string,
  ): Task {
    return createChildTask({
      tenantId: parent.tenantId,
      workspaceId: parent.workspaceId,
      principalType: parent.principalType,
      principalId: parent.principalId,
      policySnapshotVersion: parent.policySnapshotVersion,
      rootTaskId: parent.rootTaskId,
      parentTaskId: parent.id,
      parentRunId: parentRun.id,
      invokableKind: 'agent',
      invokableVersionId: agentVersionId,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt }),
      inputFingerprint: parent.inputFingerprint,
      logicalStepKey: key,
      nodePath: key,
      now: this.now,
    });
  }
}

function ownerOf(task: Task): OwnerScope {
  return {
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    principalType: task.principalType,
    principalId: task.principalId,
  };
}
function ownerOfTeam(team: {
  tenantId: string;
  workspaceId: string;
  principalType: string;
  principalId: string;
}): OwnerScope {
  return team;
}
