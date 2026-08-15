import { createRun } from '../../domain/runs/run.js';
import { createChildTask, type Task } from '../../domain/tasks/task.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { formatTeamDeliveryPrompt } from '../context/runtime-prompts.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
} from '../tasks/root-task-input.js';
import type { PlannedCollaborationActivation } from './collaboration-activation-planner.js';
import { orderedWorkItems, workRef } from '../../domain/collaboration/collaboration.js';

/**
 * Mechanical adapter from provider-neutral ParticipantActivation to the
 * canonical durable Task/Run kernel. It knows Team persistence, but no provider
 * or Execution Plane type crosses this boundary.
 */
export class TaskRunCollaborationActivationAdapter {
  public constructor(
    private readonly tasks: TaskRepository,
    private readonly admission: AdmissionRepository,
    private readonly executions: TeamExecutionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async materialize(input: {
    readonly team: TeamRun;
    readonly member: TeamMemberRun;
    readonly owner: OwnerScope;
    readonly plan: PlannedCollaborationActivation;
    readonly workItems: readonly TeamWorkItem[];
    readonly senderNameById: ReadonlyMap<string, string>;
    readonly parentTask?: Task;
  }): Promise<{ readonly taskId: string; readonly runId: string }> {
    const rootTask = await this.tasks.findById(input.team.rootTaskId);
    if (!rootTask) throw new Error('Collaboration root task is missing.');
    const parent = input.parentTask ?? rootTask;
    const causeMessageIds = Object.freeze([
      ...(input.plan.primaryWorkMessage
        ? [input.plan.primaryWorkMessage.id]
        : []),
      ...input.plan.directMessages.map((message) => message.id),
    ]);

    return this.admission.withTransaction(async (tx) => {
      const materializedTeam = input.plan.finalReview
        ? await this.advanceLead(input, tx)
        : input.team;
      const sequence = this.sequence(input, materializedTeam);
      const prompt = this.prompt(input, sequence);
      const taskKind = input.plan.finalReview
        ? 'lead_turn'
        : input.plan.workAttempt
          ? 'work_attempt'
          : 'direct_message';
      const primaryMessage =
        input.plan.primaryWorkMessage ?? input.plan.directMessages[0] ?? null;
      const task = createChildTask({
        tenantId: input.owner.tenantId,
        workspaceId: input.owner.workspaceId,
        principalType: input.owner.principalType,
        principalId: input.owner.principalId,
        policySnapshotVersion: rootTask.policySnapshotVersion,
        rootTaskId: input.team.rootTaskId,
        parentTaskId: parent.id,
        parentRunId: parent.parentRunId ?? input.team.rootRunId,
        invokableKind: 'agent',
        invokableVersionId: input.member.agentVersionId,
        inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt }),
        inputFingerprint: fingerprintRootTaskRunRequest({ prompt }),
        logicalStepKey: input.plan.activation.dedupeKey,
        nodePath: input.plan.activation.dedupeKey,
        teamMemberRunId: input.member.id,
        teamSequence: sequence,
        teamTaskKind: taskKind,
        ...(primaryMessage ? { sourceTeamMessageId: primaryMessage.id } : {}),
        ...(causeMessageIds.length
          ? { inputTeamMessageIds: causeMessageIds }
          : {}),
        now: this.now,
      });
      const run = createRun(prompt, { now: this.now });

      if (!tx.teamMessages && causeMessageIds.length)
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
          expectedRevision: materializedTeam.revision,
          owner: input.owner,
        });
        if (causeMessageIds.length) {
          const bound = await tx.teamMessages!.bindToTask({
            messageIds: causeMessageIds,
            taskId: task.id,
            owner: input.owner,
          });
          if (bound.length !== causeMessageIds.length)
            throw new Error(
              'Collaboration activation did not bind every durable cause.',
            );
        }
      } else if (causeMessageIds.length) {
        if (tx.teamMessages!.claimDirectBatchForTask) {
          const claimed = await tx.teamMessages!.claimDirectBatchForTask({
            messageIds: causeMessageIds,
            taskId: task.id,
            teamRunId: input.team.id,
            recipientMemberRunId: input.member.id,
            owner: input.owner,
          });
          if (claimed.length !== causeMessageIds.length)
            throw new Error(
              'Collaboration activation did not claim every mailbox cause.',
            );
        } else {
          if (causeMessageIds.length !== 1)
            throw new Error(
              'Collaboration mailbox cannot coalesce without batch claiming.',
            );
          await tx.teamMessages!.claimDirectForTask({
            messageId: causeMessageIds[0]!,
            taskId: task.id,
            teamRunId: input.team.id,
            recipientMemberRunId: input.member.id,
            owner: input.owner,
          });
        }
      }

      await tx.enqueueRunDispatch(
        run.id,
        run.createdAt,
        input.plan.activation.priority,
      );
      return { taskId: task.id, runId: run.id };
    });
  }

  private async advanceLead(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    tx: Parameters<Parameters<AdmissionRepository['withTransaction']>[0]>[0],
  ): Promise<TeamRun> {
    if (input.member.role !== 'lead' || !tx.teamExecutions)
      throw new Error('Lead collaboration activation is invalid.');
    const teamTasks = await tx.tasks.findByRootTaskIdForOwner(
      input.team.rootTaskId,
      input.owner,
    );
    if (
      teamTasks.some(
        (record) =>
          record.task.teamMemberRunId === input.member.id &&
          record.task.teamTaskKind === 'lead_turn' &&
          !['completed', 'failed', 'cancelled'].includes(record.task.status),
      )
    )
      throw new Error('Lead already has an active collaboration turn.');
    return tx.teamExecutions.advanceAgenticLead({
      teamRunId: input.team.id,
      expectedRevision: input.team.revision,
      owner: input.owner,
    });
  }

  private sequence(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    materializedTeam: TeamRun,
  ): number {
    if (input.plan.finalReview) return materializedTeam.leadTurnCount;
    if (input.plan.workAttempt) return input.plan.workAttempt.attemptNo;
    const firstMessage = input.plan.directMessages[0];
    if (firstMessage) return firstMessage.sequence;
    const available = input.plan.workAvailableItem;
    if (available) {
      const index = orderedWorkItems(input.workItems).findIndex(
        (item) => item.id === available.id,
      );
      if (index >= 0) return index + 1;
    }
    return 1;
  }

  private prompt(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    sequence: number,
  ): string {
    if (input.plan.finalReview) return this.finalReviewPrompt(input, sequence);
    if (input.plan.workAttempt) return this.workPrompt(input, sequence);
    if (input.plan.workAvailableItem)
      return this.workAvailablePrompt(input, sequence);
    return this.messagePrompt(input, sequence);
  }

  private workPrompt(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    sequence: number,
  ): string {
    const attempt = input.plan.workAttempt!;
    const work = input.workItems.find((item) => item.id === attempt.workItemId);
    if (!work) throw new Error('Collaboration work item is missing.');
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
      sequence,
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

  private workAvailablePrompt(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    sequence: number,
  ): string {
    const work = input.plan.workAvailableItem!;
    const index = orderedWorkItems(input.workItems).findIndex(
      (item) => item.id === work.id,
    );
    const ref = index >= 0 ? workRef(index) : 'an open item';
    return formatTeamDeliveryPrompt({
      teamId: input.team.id.slice(0, 8),
      to: input.member.name,
      kind: 'direct',
      from: 'collaboration',
      sequence,
      body: [
        `Open actionable Work is available: ${ref} — ${safe(work.subject)}.`,
        work.description ? `Brief: ${safe(work.description)}` : null,
        this.messageDigest(input),
        'Read board_list for authoritative state. Claim the item with board_claim only if you choose to own it; merely receiving this turn does not assign Work.',
      ]
        .filter((part): part is string => Boolean(part))
        .join('\n'),
    });
  }

  private finalReviewPrompt(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    sequence: number,
  ): string {
    return formatTeamDeliveryPrompt({
      teamId: input.team.id.slice(0, 8),
      to: input.member.name,
      kind: 'lead_turn',
      from: 'agent-server',
      sequence,
      body: [
        input.plan.reviewFeedback
          ? `A reviewer rejected the previous completion request. Feedback: ${safe(input.plan.reviewFeedback)}`
          : 'Review the current durable Workboard and latest participant results.',
        this.messageDigest(input),
        'Use board_accept or board_request_changes for submitted/blocked Work, create remaining useful Work when needed, and call collaboration_finish only when the required board is accepted. Do not wait for participants that are already running.',
      ]
        .filter((part): part is string => Boolean(part))
        .join('\n'),
    });
  }

  private messagePrompt(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
    sequence: number,
  ): string {
    const first = input.plan.directMessages[0];
    if (!first)
      throw new Error('Collaboration message activation has no message.');
    return formatTeamDeliveryPrompt({
      teamId: input.team.id.slice(0, 8),
      to: input.member.name,
      kind: 'direct',
      from: first.senderMemberRunId
        ? (input.senderNameById.get(first.senderMemberRunId) ?? 'collaboration')
        : 'collaboration',
      sequence,
      body: [
        'You have durable collaboration updates.',
        this.messageDigest(input),
        'Read board_list/inbox_list for current facts. Messages do not assign Work by themselves. If you choose to take an open item, use board_claim explicitly.',
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
