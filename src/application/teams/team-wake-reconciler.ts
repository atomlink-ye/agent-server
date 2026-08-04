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
    const workItems = await this.executions.findWorkItemsByTeamRunId(
      team.id,
      owner,
    );
    const dependencies = await this.executions.findWorkDependenciesByTeamRunId(
      team.id,
      owner,
    );
    const workById = new Map(workItems.map((work) => [work.id, work]));
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
        if (message.kind === 'direct') {
          if (member.status === 'active') break;
          const rootTask = await this.tasks.findById(team.rootTaskId);
          if (!rootTask) throw new Error('Team root task is missing.');
          const sender = message.senderMemberRunId
            ? members.find(
                (candidate) => candidate.id === message.senderMemberRunId,
              )
            : undefined;
          if (!sender) continue;
          const prompt = this.directPrompt(sender.name, message);
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
            logicalStepKey: `member:${team.id}:${member.id}:direct:${message.id}`,
            nodePath: `member:${team.id}:${member.id}:direct:${message.id}`,
            teamMemberRunId: member.id,
            teamSequence: message.sequence,
            teamTaskKind: 'direct_message',
            sourceTeamMessageId: message.id,
            inputTeamMessageIds: [message.id],
            now: this.now,
          });
          const run = createRun(prompt, { now: this.now });
          try {
            await this.admission.withTransaction(async (tx) => {
              if (!tx.teamMessages)
                throw new Error(
                  'Team message transaction dependency is unavailable.',
                );
              await tx.tasks.save(task);
              await tx.runs.save(run, { taskId: task.id, attempt: 1 });
              await tx.teamMessages.claimDirectForTask({
                messageId: message.id,
                taskId: task.id,
                teamRunId: team.id,
                recipientMemberRunId: member.id,
                owner,
              });
              await tx.enqueueRunDispatch(run.id, run.createdAt);
            });
          } catch (error) {
            // A concurrent Task/Run can make this recipient busy after the
            // read above. The transaction rolls back and the durable message
            // remains queued for the next explicit reconcile.
            if (
              error instanceof Error &&
              (error as { code?: string }).code === 'invalid_transition'
            )
              break;
            throw error;
          }
          materialized += 1;
          break;
        }
        const attempt = message.attemptId
          ? attempts.find((candidate) => candidate.id === message.attemptId)
          : undefined;
        if (!attempt || attempt.executionTaskId || attempt.status !== 'queued')
          continue;
        // A queued wake is durable evidence, not an error.  Leave it queued
        // until every declared dependency is accepted, then a later reconcile
        // materializes the exact same Message/Attempt atomically.
        if (
          dependencies
            .filter((edge) => edge.workItemId === attempt.workItemId)
            .some(
              (edge) =>
                workById.get(edge.dependsOnWorkItemId)?.status !== 'accepted',
            )
        )
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
            expectedRevision: team.revision,
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

  private directPrompt(senderName: string, message: TeamMessage): string {
    const sender = senderName
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 256);
    const body = message.body
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 512);
    return `You received a direct Team message from ${sender}: ${body}\n\nAcknowledge or act on this message as appropriate. This delivery is not assigned Work: do not submit, review, accept, or otherwise change Work merely because of this message.`;
  }
}
