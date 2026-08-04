import { createChildTask } from '../../domain/tasks/task.js';
import { createRun } from '../../domain/runs/run.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import type { TeamMessage } from '../../domain/teams/team-message.js';

export class TeamWakeReconciler {
  public constructor(
    private readonly messages: TeamMessageRepository,
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    private readonly admission: AdmissionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async reconcileQueuedWakeRoots(): Promise<number> {
    let materialized = 0;
    for (const root of await this.messages.listQueuedWakeRoots()) {
      materialized += await this.reconcileForRootTask(
        root.rootTaskId,
        root.owner,
      );
    }
    return materialized;
  }

  public async reconcileForRootTask(
    rootTaskId: string,
    owner: OwnerScope,
  ): Promise<number> {
    const team = await this.executions.findTeamRunByRootTaskId(
      rootTaskId,
      owner,
    );
    if (!team || team.status !== 'active') return 0;
    const members = await this.executions.findMembersByTeamRunId(
      team.id,
      owner,
    );
    const attempts = await this.executions.findAttemptsByTeamRunId(
      team.id,
      owner,
    );
    let materialized = 0;
    for (const member of members.filter(
      (candidate) => candidate.role === 'member',
    )) {
      const queued = await this.messages.listQueuedForMember(
        team.id,
        member.id,
        owner,
      );
      for (const message of queued) {
        const attempt = message.attemptId
          ? attempts.find((candidate) => candidate.id === message.attemptId)
          : undefined;
        if (!attempt || attempt.executionTaskId || attempt.status !== 'queued')
          continue;
        const rootTask = await this.tasks.findById(team.rootTaskId);
        if (!rootTask) throw new Error('Team root task is missing.');
        const prompt = this.assignmentPrompt(message, attempt.attemptNo);
        const task = createChildTask({
          tenantId: owner.tenantId,
          workspaceId: owner.workspaceId,
          principalType: owner.principalType,
          principalId: owner.principalId,
          policySnapshotVersion: rootTask.policySnapshotVersion,
          rootTaskId: team.rootTaskId,
          parentTaskId: rootTask.id,
          parentRunId: team.rootRunId,
          invokableKind: 'agent',
          invokableVersionId: member.agentVersionId,
          inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt }),
          inputFingerprint: rootTask.inputFingerprint,
          logicalStepKey: `member:${team.id}:${member.id}:wake:${attempt.id}`,
          nodePath: `member:${team.id}:${member.id}:wake:${attempt.id}`,
          teamMemberRunId: member.id,
          teamSequence: attempt.attemptNo,
          teamTaskKind: 'work_attempt',
          sourceTeamMessageId: message.id,
          inputTeamMessageIds: [message.id],
          now: this.now,
        });
        const run = createRun(prompt, { now: this.now });
        await this.admission.withTransaction(async (tx) => {
          if (!tx.teamMessages || !tx.teamExecutions)
            throw new Error(
              'Team wake transaction dependencies are unavailable.',
            );
          await tx.tasks.save(task);
          await tx.runs.save(run, { taskId: task.id, attempt: 1 });
          await tx.teamExecutions.materializeAttempt({
            attemptId: attempt.id,
            executionTaskId: task.id,
            teamRunId: team.id,
            assigneeMemberId: member.id,
            owner,
          });
          await tx.teamMessages.bindToTask({
            messageIds: [message.id],
            taskId: task.id,
            owner,
          });
          await tx.enqueueRunDispatch(run.id, run.createdAt);
        });
        materialized += 1;
      }
    }
    return materialized;
  }

  private assignmentPrompt(message: TeamMessage, attemptNo: number): string {
    const body = message.body
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .trim()
      .slice(0, 512);
    return `You are completing assigned Team work. Wake: ${body}. Attempt number: ${attemptNo}. Use the canonical Team tools to checkpoint and submit a concise result.`;
  }
}
