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
import {
  decodeRootTaskRunRequestSnapshotRef,
  encodeRootTaskRunRequestSnapshotRef,
} from '../tasks/root-task-input.js';
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
    const rootInput = rootTaskInput(rootTask.inputSnapshotRef);
    if (rootInput === null)
      throw new Error(
        'Team root task input is unavailable or outside the allowed bounds.',
      );
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
      `team_run_id: ${teamRun.id}\n\nYou are ${spec.lead.name}, the lead. Create exactly ${spec.roster.length} work items with team_task_create, one for each teammate: ${spec.roster.map((member) => member.name).join(', ')}. Then stop without finalizing; teammates will run next.\n\nOriginal request: ${rootInput}`,
      lead.agentVersionId,
    );
    const leadRun = createRun(rootInput, { now: this.now });
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
    const members = (
      await execution.findMembersByTeamRunId(teamRun.id, ownerOfTeam(teamRun))
    ).filter((member) => member.role === 'member');
    if (
      members.length === 0 ||
      items.length !== members.length ||
      items.some((item) => item.status !== 'completed')
    )
      return;
    const memberIds = new Set(members.map((member) => member.id));
    const ownedItemMemberIds = items.map((item) => item.ownerMemberId);
    if (
      ownedItemMemberIds.some(
        (memberId) => memberId === null || !memberIds.has(memberId),
      ) ||
      new Set(ownedItemMemberIds).size !== members.length
    )
      return;
    const childTasks = await tasks.findByRootTaskIdForOwner(
      teamRun.rootTaskId,
      ownerOf(task),
    );
    const memberTaskRecords = childTasks.filter((record) =>
      record.task.logicalStepKey?.startsWith(`member:${teamRun.id}:`),
    );
    if (
      memberTaskRecords.length !== members.length ||
      memberTaskRecords.some(
        (record) =>
          record.task.status !== 'completed' ||
          !record.latestRun ||
          record.latestRun.status !== 'succeeded' ||
          !members.some(
            (member) =>
              record.task.logicalStepKey ===
              `member:${teamRun.id}:${member.id}:member_work`,
          ),
      )
    )
      return;
    const root = await tasks.findById(teamRun.rootTaskId);
    if (!root) throw new Error('Team root task not found.');
    const rootInput = rootTaskInput(root.inputSnapshotRef);
    if (rootInput === null)
      throw new Error(
        'Team root task input is unavailable or outside the allowed bounds.',
      );
    const lead = (
      await execution.findMembersByTeamRunId(teamRun.id, ownerOfTeam(teamRun))
    ).find((m) => m.role === 'lead');
    if (!lead) throw new Error('Team lead not found.');
    const continuation = this.child(
      root,
      completed,
      lead,
      `lead:${teamRun.id}:${lead.id}:finalize`,
      this.finalizationPrompt(items, rootInput),
      lead.agentVersionId,
    );
    const run = createRun(
      'Review completed teammate work and return the final answer.',
      {
        now: this.now,
      },
    );
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

  public async completeLeadFinalization(input: {
    readonly run: Run;
    readonly task: Task;
    readonly execution: TeamExecutionRepository;
  }): Promise<void> {
    const finalText = input.run.result?.text.trim();
    if (!finalText)
      throw new Error(
        'Lead finalization produced no result text; team completion is blocked.',
      );
    const teamRun = await input.execution.findTeamRunByRootTaskId(
      input.task.rootTaskId,
      ownerOf(input.task),
    );
    if (!teamRun || teamRun.phase !== 'lead_finalize') return;
    await input.execution.completeTeamRunAtomically({
      teamRunId: teamRun.id,
      rootRunId: teamRun.rootRunId,
      rootTaskId: teamRun.rootTaskId,
      finalText,
      owner: ownerOfTeam(teamRun),
      updatedAt: input.run.updatedAt,
    });
  }

  private finalizationPrompt(
    items: ReadonlyArray<{
      subject: string;
      description: string | null;
      completionSummary: string | null;
    }>,
    rootInput: string,
  ): string {
    if (
      items.length === 0 ||
      items.length > CollaborativeTeamExecutor.MAX_FINALIZATION_ITEMS
    )
      throw new Error('Team finalization input is outside the allowed bounds.');
    for (const item of items) {
      if (
        item.subject.length === 0 ||
        item.subject.length > CollaborativeTeamExecutor.MAX_SUBJECT_CHARS ||
        item.completionSummary === null ||
        item.completionSummary.length === 0
      )
        throw new Error(
          'Team finalization input is outside the allowed bounds.',
        );
    }
    const completedWork = items
      .map(
        (item) =>
          `- Subject: ${safeTeamText(item.subject)}\n  Description/context: ${safeTeamText(item.description ?? '(none)')}\n  Completion summary: ${safeTeamText(item.completionSummary!)}`,
      )
      .join('\n');
    const prompt = `Return the final answer as plain text. Do not call team_task_list or team_complete, and do not inspect repository files. Use the original request and synthesize the completed teammate work below.\n\nOriginal request: ${safeTeamText(rootInput)}\n\n${completedWork}`;
    return prompt;
  }

  private static readonly MAX_FINALIZATION_ITEMS = 8;
  private static readonly MAX_SUBJECT_CHARS = 256;

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

const MAX_ROOT_INPUT_BYTES = 64 * 1024;

function rootTaskInput(snapshotRef: string): string | null {
  try {
    const prompt = decodeRootTaskRunRequestSnapshotRef(snapshotRef).prompt;
    if (!prompt || Buffer.byteLength(prompt, 'utf8') > MAX_ROOT_INPUT_BYTES)
      return null;
    return prompt;
  } catch {
    return null;
  }
}

function safeTeamText(value: string): string {
  return value
    .replace(/bearer\s+[^\s]+/gi, 'bearer [redacted]')
    .replace(
      /\b(?:credential|token|password|secret|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi,
      '[redacted credential]',
    )
    .replace(
      /(?:^|[\s"'=])(?:~\/|\/|[A-Za-z]:\\)[^\s"'`]+/g,
      '$1[redacted path]',
    );
}

function ownerOfTeam(team: {
  tenantId: string;
  workspaceId: string;
  principalType: string;
  principalId: string;
}): OwnerScope {
  return team;
}
