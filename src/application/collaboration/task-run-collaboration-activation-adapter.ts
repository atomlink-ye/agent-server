import { createRun } from '../../domain/runs/run.js';
import { createChildTask } from '../../domain/tasks/task.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type { OwnerScope } from '../ports/team-execution-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { formatTeamDeliveryPrompt } from '../context/runtime-prompts.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
} from '../tasks/root-task-input.js';
import type { PlannedCollaborationActivation } from './collaboration-activation-planner.js';

/**
 * Mechanical adapter from provider-neutral CollaborationActivation to the
 * canonical durable Task/Run kernel. No provider or Execution Plane types cross
 * this boundary.
 */
export class TaskRunCollaborationActivationAdapter {
  public constructor(
    private readonly tasks: TaskRepository,
    private readonly admission: AdmissionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async materialize(input: {
    readonly team: TeamRun;
    readonly member: TeamMemberRun;
    readonly owner: OwnerScope;
    readonly plan: PlannedCollaborationActivation;
    readonly workItem: TeamWorkItem | null;
    readonly senderNameById: ReadonlyMap<string, string>;
  }): Promise<{ readonly taskId: string; readonly runId: string }> {
    const rootTask = await this.tasks.findById(input.team.rootTaskId);
    if (!rootTask) throw new Error('Collaboration root task is missing.');
    const prompt =
      input.plan.workAttempt && input.workItem
        ? this.workPrompt(input, input.workItem)
        : this.messagePrompt(input);
    const primary =
      input.plan.primaryWorkMessage ?? input.plan.directMessages[0];
    if (!primary)
      throw new Error('Collaboration activation has no durable cause.');
    const causeMessageIds = Object.freeze([
      ...(input.plan.primaryWorkMessage
        ? [input.plan.primaryWorkMessage.id]
        : []),
      ...input.plan.directMessages.map((message) => message.id),
    ]);
    const task = createChildTask({
      tenantId: input.owner.tenantId,
      workspaceId: input.owner.workspaceId,
      principalType: input.owner.principalType,
      principalId: input.owner.principalId,
      policySnapshotVersion: rootTask.policySnapshotVersion,
      rootTaskId: input.team.rootTaskId,
      parentTaskId: rootTask.id,
      parentRunId: input.team.rootRunId,
      invokableKind: 'agent',
      invokableVersionId: input.member.agentVersionId,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt }),
      inputFingerprint: fingerprintRootTaskRunRequest({ prompt }),
      logicalStepKey: input.plan.activation.dedupeKey,
      nodePath: `collaboration:${input.team.id}:${input.member.id}:${primary.sequence}`,
      teamMemberRunId: input.member.id,
      teamSequence: input.plan.workAttempt?.attemptNo ?? primary.sequence,
      teamTaskKind: input.plan.workAttempt ? 'work_attempt' : 'direct_message',
      sourceTeamMessageId: primary.id,
      inputTeamMessageIds: causeMessageIds,
      now: this.now,
    });
    const run = createRun(prompt, { now: this.now });
    await this.admission.withTransaction(async (tx) => {
      if (!tx.teamMessages)
        throw new Error(
          'Collaboration message transaction dependency is unavailable.',
        );
      await tx.tasks.save(task);
      await tx.runs.save(run, { taskId: task.id, attempt: 1 });
      if (input.plan.workAttempt) {
        if (!tx.teamExecutions)
          throw new Error(
            'Collaboration execution transaction dependency is unavailable.',
          );
        await tx.teamExecutions.materializeAttempt({
          attemptId: input.plan.workAttempt.id,
          executionTaskId: task.id,
          teamRunId: input.team.id,
          assigneeMemberId: input.member.id,
          expectedRevision: input.team.revision,
          owner: input.owner,
        });
        const bound = await tx.teamMessages.bindToTask({
          messageIds: causeMessageIds,
          taskId: task.id,
          owner: input.owner,
        });
        if (bound.length !== causeMessageIds.length)
          throw new Error(
            'Collaboration activation did not bind every durable cause.',
          );
      } else if (tx.teamMessages.claimDirectBatchForTask) {
        await tx.teamMessages.claimDirectBatchForTask({
          messageIds: causeMessageIds,
          taskId: task.id,
          teamRunId: input.team.id,
          recipientMemberRunId: input.member.id,
          owner: input.owner,
        });
      } else {
        if (causeMessageIds.length !== 1)
          throw new Error(
            'Collaboration mailbox cannot coalesce without batch claiming.',
          );
        await tx.teamMessages.claimDirectForTask({
          messageId: causeMessageIds[0]!,
          taskId: task.id,
          teamRunId: input.team.id,
          recipientMemberRunId: input.member.id,
          owner: input.owner,
        });
      }
      await tx.enqueueRunDispatch(
        run.id,
        run.createdAt,
        input.plan.activation.priority,
      );
    });
    return { taskId: task.id, runId: run.id };
  }

  private workPrompt(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    work: TeamWorkItem,
  ): string {
    const attempt = input.plan.workAttempt!;
    const direct = this.messageDigest(input);
    return formatTeamDeliveryPrompt({
      teamId: input.team.id.slice(0, 8),
      to: input.member.name,
      kind: attempt.attemptNo > 1 ? 'rework' : 'wake',
      from: input.plan.primaryWorkMessage?.senderMemberRunId
        ? (input.senderNameById.get(
            input.plan.primaryWorkMessage.senderMemberRunId,
          ) ?? 'collaboration')
        : 'collaboration',
      sequence: input.plan.primaryWorkMessage?.sequence ?? attempt.attemptNo,
      body: [
        `You have assigned Work: ${safe(work.subject)}.`,
        work.description ? `Brief: ${safe(work.description)}` : null,
        attempt.feedback ? `Feedback: ${safe(attempt.feedback)}` : null,
        `Attempt number: ${attempt.attemptNo}.`,
        direct,
        'Use board_checkpoint while working and board_submit when the semantic result is ready. Use board_block for a real blocker. Board and mailbox state are durable; use board_list/inbox_list for details.',
      ]
        .filter((part): part is string => Boolean(part))
        .join('\n'),
    });
  }

  private messagePrompt(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
  ): string {
    const first = input.plan.directMessages[0]!;
    return formatTeamDeliveryPrompt({
      teamId: input.team.id.slice(0, 8),
      to: input.member.name,
      kind: 'direct',
      from: first.senderMemberRunId
        ? (input.senderNameById.get(first.senderMemberRunId) ?? 'collaboration')
        : 'collaboration',
      sequence: first.sequence,
      body: [
        'You have durable collaboration updates.',
        this.messageDigest(input),
        'Read board_list/inbox_list for current facts. Messages do not assign Work by themselves. If a message asks you to take an open item, use board_claim explicitly.',
      ].join('\n'),
    });
  }

  private messageDigest(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
  ): string | null {
    if (!input.plan.directMessages.length) return null;
    return [
      'Messages:',
      ...input.plan.directMessages.map((message) => {
        const sender = message.senderMemberRunId
          ? (input.senderNameById.get(message.senderMemberRunId) ?? 'participant')
          : 'system';
        return `- M-${message.sequence} from ${safe(sender)}: ${safe(message.body)}`;
      }),
    ].join('\n');
  }
}

function safe(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1024);
}
