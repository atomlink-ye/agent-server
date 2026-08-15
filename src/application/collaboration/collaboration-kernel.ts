import { createHash } from 'node:crypto';

import {
  messageRef,
  orderedWorkItems,
  projectBoardStatus,
  projectMessageStatus,
  resolveMessageRef,
  resolveWorkRef,
  workRef,
} from '../../domain/collaboration/collaboration.js';
import type { CollaborationRepository } from '../ports/collaboration-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../ports/team-execution-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import type { TeamToolContext } from '../teams/team-tool-context.js';
import { TeamContextError } from '../teams/team-tool-context.js';
import { safeText } from '../teams/safe-team-text.js';
import type { TeamWakeReconciler } from '../teams/team-wake-reconciler.js';
import { CollaborationPolicy, CollaborationPolicyError } from './collaboration-policy.js';

/**
 * Provider-neutral collaboration semantics. It owns durable Workboard/Mailbox
 * mutations and knows nothing about Paseo, RuntimeSession bindings or provider
 * identities. Runtime delivery happens after these facts are committed.
 */
export class CollaborationKernel {
  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly journal: CollaborationRepository,
    private readonly messages: TeamMessageRepository,
    private readonly events: Pick<RunEventRepository, 'append'>,
    private readonly wake?: Pick<TeamWakeReconciler, 'reconcileForRootTask'>,
    private readonly policy = new CollaborationPolicy(),
  ) {}

  public async state(context: TeamToolContext) {
    this.policy.require(context, 'board.read');
    const [work, messages, checkpoints, submissions] = await Promise.all([
      this.boardList(context),
      this.messages.listForTeamRun?.(context.teamRun.id, context.owner) ?? [],
      this.journal.listCheckpoints(context.teamRun.id, context.owner),
      this.journal.listSubmissions(context.teamRun.id, context.owner),
    ]);
    return {
      status: context.teamRun.status,
      participant: {
        name: context.member.name,
        role: context.member.role,
        status: context.member.status,
      },
      capabilities: this.policy.capabilities(context),
      board: {
        count: work.length,
        open: work.filter((item) => item.status === 'open').length,
        active: work.filter((item) =>
          ['assigned', 'in_progress', 'blocked', 'submitted'].includes(item.status),
        ).length,
        accepted: work.filter((item) => item.status === 'accepted').length,
      },
      mailbox: {
        pending: messages.filter(
          (message) =>
            message.kind === 'direct' &&
            message.recipientMemberRunId === context.member.id &&
            message.status === 'queued',
        ).length,
      },
      checkpoint_count: checkpoints.length,
      submission_count: submissions.length,
    };
  }

  public async boardList(context: TeamToolContext) {
    this.policy.require(context, 'board.read');
    const [items, attempts, dependencies, members, checkpoints, submissions] =
      await Promise.all([
        this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner),
        this.executions.findAttemptsByTeamRunId(context.teamRun.id, context.owner),
        this.executions.findWorkDependenciesByTeamRunId(
          context.teamRun.id,
          context.owner,
        ),
        this.executions.findMembersByTeamRunId(context.teamRun.id, context.owner),
        this.journal.listCheckpoints(context.teamRun.id, context.owner),
        this.journal.listSubmissions(context.teamRun.id, context.owner),
      ]);
    const ordered = orderedWorkItems(items);
    const refById = new Map(ordered.map((item, index) => [item.id, workRef(index)]));
    const nameById = new Map(members.map((member) => [member.id, member.name]));
    return ordered.map((item, index) => {
      const workAttempts = attempts
        .filter((attempt) => attempt.workItemId === item.id)
        .sort((a, b) => a.attemptNo - b.attemptNo);
      const latestAttempt = workAttempts.at(-1) ?? null;
      const latestCheckpoint = checkpoints
        .filter((checkpoint) => checkpoint.workItemId === item.id)
        .at(-1);
      const latestSubmission = submissions
        .filter((submission) => submission.workItemId === item.id)
        .at(-1);
      return {
        work_ref: workRef(index),
        subject: safeText(item.subject) ?? '',
        description: safeText(item.description),
        status: projectBoardStatus(item, workAttempts),
        owner: item.ownerMemberId ? nameById.get(item.ownerMemberId) ?? null : null,
        dependency_refs: dependencies
          .filter((edge) => edge.workItemId === item.id)
          .flatMap((edge) => {
            const ref = refById.get(edge.dependsOnWorkItemId);
            return ref ? [ref] : [];
          }),
        actionable:
          projectBoardStatus(item, workAttempts) === 'open' &&
          dependencies
            .filter((edge) => edge.workItemId === item.id)
            .every(
              (edge) =>
                items.find((candidate) => candidate.id === edge.dependsOnWorkItemId)
                  ?.status === 'accepted',
            ),
        latest_attempt_no: latestAttempt?.attemptNo ?? null,
        latest_checkpoint: latestCheckpoint
          ? {
              summary: safeText(latestCheckpoint.summary),
              next_step: safeText(latestCheckpoint.nextStep),
              blocker: safeText(latestCheckpoint.blocker),
              evidence_refs: latestCheckpoint.evidenceRefs,
            }
          : null,
        latest_submission: latestSubmission
          ? {
              attempt_no: latestSubmission.attemptNo,
              summary: safeText(latestSubmission.summary),
              evidence_refs: latestSubmission.evidenceRefs,
              artifact_refs: latestSubmission.artifactRefs,
            }
          : null,
      };
    });
  }

  public async createWork(
    context: TeamToolContext,
    input: {
      subject: string;
      description?: string;
      assignee?: string;
      dependencyRefs?: readonly string[];
    },
  ) {
    this.policy.require(context, 'board.create');
    const items = await this.executions.findWorkItemsByTeamRunId(
      context.teamRun.id,
      context.owner,
    );
    const dependencyIds = (input.dependencyRefs ?? []).map((ref) => {
      const work = resolveWorkRef(ref, items);
      if (!work) throw new TeamContextError('not_found');
      return work.id;
    });
    const subject = requireSafeText(input.subject);
    const description = input.description ? safeText(input.description) : null;
    if (input.assignee) {
      const assignee = await this.memberByName(context, input.assignee, true);
      const result = await this.executions.createAssignedWork({
        teamRunId: context.teamRun.id,
        sourceRunId: context.run.id,
        leadTaskId: context.task.id,
        assigneeMemberId: assignee.id,
        subject,
        description,
        dependsOnWorkItemIds: dependencyIds,
        commandHash: commandHash('board_create_assigned', input),
        expectedRevision: context.teamRun.revision,
        owner: context.owner,
      });
      await this.wake?.reconcileForRootTask(context.teamRun.rootTaskId, context.owner);
      return {
        work_ref: await this.refForWork(context, result.item.id),
        status: 'assigned',
        owner: assignee.name,
      };
    }
    const item = await this.journal.createOpenWork({
      teamRunId: context.teamRun.id,
      createdByMemberId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      subject,
      description,
      dependsOnWorkItemIds: dependencyIds,
      commandHash: commandHash('board_create_open', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return {
      work_ref: await this.refForWork(context, item.id),
      status: 'open',
      owner: null,
    };
  }

  public async assignWork(
    context: TeamToolContext,
    input: { workRef: string; assignee: string },
  ) {
    this.policy.require(context, 'board.assign');
    const item = await this.workByRef(context, input.workRef);
    const assignee = await this.memberByName(context, input.assignee, true);
    const result = await this.journal.assignOpenWork({
      teamRunId: context.teamRun.id,
      workItemId: item.id,
      assigneeMemberId: assignee.id,
      actorMemberId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      commandHash: commandHash('board_assign', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    await this.wake?.reconcileForRootTask(context.teamRun.rootTaskId, context.owner);
    return { work_ref: input.workRef, status: 'assigned', owner: assignee.name, attempt_no: result.attempt.attemptNo };
  }

  public async claimWork(context: TeamToolContext, input: { workRef: string }) {
    this.policy.require(context, 'board.claim');
    const item = await this.workByRef(context, input.workRef);
    const result = await this.journal.claimOpenWork({
      teamRunId: context.teamRun.id,
      workItemId: item.id,
      claimantMemberId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      commandHash: commandHash('board_claim', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return {
      work_ref: input.workRef,
      status: 'assigned',
      owner: context.member.name,
      attempt_no: result.attempt.attemptNo,
      activation: 'next_turn',
    };
  }

  public async checkpoint(
    context: TeamToolContext,
    input: {
      summary: string;
      nextStep?: string;
      blocker?: string;
      evidenceRefs?: readonly string[];
    },
  ) {
    this.policy.require(context, 'board.checkpoint');
    const current = await this.currentAttempt(context);
    const checkpoint = await this.journal.recordCheckpoint({
      teamRunId: context.teamRun.id,
      workItemId: current.attempt.workItemId,
      attemptId: current.attempt.id,
      participantMemberId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      summary: requireSafeText(input.summary),
      nextStep: input.nextStep ? safeText(input.nextStep) : null,
      blocker: input.blocker ? safeText(input.blocker) : null,
      evidenceRefs: normalizeRefs(input.evidenceRefs),
      owner: context.owner,
    });
    await this.events.append(context.run.id, 'output', {
      kind: 'collaboration_checkpoint',
      work_ref: current.ref,
      summary: safeText(checkpoint.summary),
      next_step: safeText(checkpoint.nextStep),
      blocker: safeText(checkpoint.blocker),
      evidence_refs: checkpoint.evidenceRefs,
    });
    return {
      checkpointed: true,
      work_ref: current.ref,
      summary: safeText(checkpoint.summary),
      next_step: safeText(checkpoint.nextStep),
      blocker: safeText(checkpoint.blocker),
      evidence_refs: checkpoint.evidenceRefs,
    };
  }

  public async blockWork(context: TeamToolContext, input: { summary: string }) {
    this.policy.require(context, 'board.block');
    const current = await this.currentAttempt(context);
    await this.journal.blockCurrentAttempt({
      teamRunId: context.teamRun.id,
      workItemId: current.attempt.workItemId,
      attemptId: current.attempt.id,
      participantMemberId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      summary: requireSafeText(input.summary),
      owner: context.owner,
    });
    return { work_ref: current.ref, status: 'blocked', summary: safeText(input.summary) };
  }

  public async submitWork(
    context: TeamToolContext,
    input: { summary: string; evidenceRefs?: readonly string[]; artifactRefs?: readonly string[] },
  ) {
    this.policy.require(context, 'board.submit');
    const current = await this.currentAttempt(context);
    const result = await this.journal.submitCurrentAttempt({
      teamRunId: context.teamRun.id,
      workItemId: current.attempt.workItemId,
      attemptId: current.attempt.id,
      participantMemberId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      summary: requireSafeText(input.summary),
      evidenceRefs: normalizeRefs(input.evidenceRefs),
      artifactRefs: normalizeRefs(input.artifactRefs),
      owner: context.owner,
    });
    return {
      work_ref: current.ref,
      submitted: true,
      status: 'submitted',
      attempt_no: result.attempt.attemptNo,
      summary: safeText(result.submission.summary),
      evidence_refs: result.submission.evidenceRefs,
      artifact_refs: result.submission.artifactRefs,
    };
  }

  public async acceptWork(context: TeamToolContext, input: { workRef: string }) {
    this.policy.require(context, 'board.review');
    const item = await this.workByRef(context, input.workRef);
    await this.executions.acceptWork({
      teamRunId: context.teamRun.id,
      workItemId: item.id,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      commandHash: commandHash('board_accept', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return { work_ref: input.workRef, status: 'accepted' };
  }

  public async requestChanges(
    context: TeamToolContext,
    input: { workRef: string; assignee: string; feedback: string },
  ) {
    this.policy.require(context, 'board.review');
    const item = await this.workByRef(context, input.workRef);
    const assignee = await this.memberByName(context, input.assignee, true);
    const feedback = requireSafeText(input.feedback);
    if (item.status === 'blocked') {
      const result = await this.journal.resumeBlockedWork({
        teamRunId: context.teamRun.id,
        workItemId: item.id,
        assigneeMemberId: assignee.id,
        actorMemberId: context.member.id,
        sourceTaskId: context.task.id,
        sourceRunId: context.run.id,
        feedback,
        commandHash: commandHash('board_resume', input),
        expectedRevision: context.teamRun.revision,
        owner: context.owner,
      });
      await this.wake?.reconcileForRootTask(context.teamRun.rootTaskId, context.owner);
      return { work_ref: input.workRef, status: 'in_progress', attempt_no: result.attempt.attemptNo, owner: assignee.name };
    }
    const attempt = await this.executions.requestRework({
      teamRunId: context.teamRun.id,
      workItemId: item.id,
      assigneeMemberId: assignee.id,
      feedback,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      commandHash: commandHash('board_request_changes', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    await this.wake?.reconcileForRootTask(context.teamRun.rootTaskId, context.owner);
    return { work_ref: input.workRef, status: 'in_progress', attempt_no: attempt.attemptNo, owner: assignee.name };
  }

  public async cancelWork(context: TeamToolContext, input: { workRef: string }) {
    this.policy.require(context, 'board.cancel');
    const item = await this.workByRef(context, input.workRef);
    await this.executions.cancelWork({
      teamRunId: context.teamRun.id,
      workItemId: item.id,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      commandHash: commandHash('board_cancel', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return { work_ref: input.workRef, status: 'cancelled' };
  }

  public async inboxList(context: TeamToolContext) {
    this.policy.require(context, 'mailbox.read');
    const messages = await this.allMessages(context);
    const items = await this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner);
    return messages
      .filter(
        (message) =>
          message.kind === 'direct' && message.recipientMemberRunId === context.member.id,
      )
      .map((message) => ({
        message_ref: messageRef(message.sequence),
        from: message.senderMemberRunId,
        body: safeText(message.body),
        about_work_ref: message.aboutWorkItemId
          ? this.refForExistingWork(message.aboutWorkItemId, items)
          : null,
        reply_to_ref: message.replyToMessageId
          ? messageRef(
              messages.find((candidate) => candidate.id === message.replyToMessageId)
                ?.sequence ?? 0,
            )
          : null,
        priority: message.priority,
        requires_ack: message.requiresAck,
        status: projectMessageStatus(message),
        created_at: message.createdAt,
      }))
      .filter((message) => message.status !== 'cancelled');
  }

  public async sendMessage(
    context: TeamToolContext,
    input: {
      recipient: string;
      body: string;
      aboutWorkRef?: string;
      replyToRef?: string;
      priority?: 'normal' | 'urgent';
      requiresAck?: boolean;
    },
  ) {
    this.policy.require(context, 'mailbox.send');
    const recipient = await this.memberByName(context, input.recipient, false);
    if (recipient.id === context.member.id) throw new TeamContextError('invalid_request');
    const items = await this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner);
    const about = input.aboutWorkRef ? resolveWorkRef(input.aboutWorkRef, items) : null;
    if (input.aboutWorkRef && !about) throw new TeamContextError('not_found');
    const all = await this.allMessages(context);
    const reply = input.replyToRef ? resolveMessageRef(input.replyToRef, all) : null;
    if (input.replyToRef && !reply) throw new TeamContextError('not_found');
    const body = requireSafeText(input.body);
    const message = await this.messages.sendDirect({
      teamRunId: context.teamRun.id,
      senderMemberRunId: context.member.id,
      recipientMemberRunId: recipient.id,
      dedupKey: `collaboration:${context.run.id}:${commandHash('message_send', input)}`,
      body,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      expectedRevision: context.teamRun.revision,
      aboutWorkItemId: about?.id ?? null,
      replyToMessageId: reply?.id ?? null,
      priority: input.priority ?? 'normal',
      requiresAck: input.requiresAck ?? false,
      owner: context.owner,
    });
    await this.wake?.reconcileForRootTask(context.teamRun.rootTaskId, context.owner);
    return {
      sent: true,
      message_ref: messageRef(message.sequence),
      recipient: recipient.name,
      status: 'pending',
    };
  }

  public async acknowledgeMessage(context: TeamToolContext, input: { messageRef: string }) {
    this.policy.require(context, 'mailbox.ack');
    if (!this.messages.acknowledgeDirect) throw new TeamContextError('not_allowed');
    const message = resolveMessageRef(input.messageRef, await this.allMessages(context));
    if (!message || message.recipientMemberRunId !== context.member.id)
      throw new TeamContextError('not_found');
    const acknowledged = await this.messages.acknowledgeDirect({
      messageId: message.id,
      recipientMemberRunId: context.member.id,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      owner: context.owner,
    });
    return { message_ref: messageRef(acknowledged.sequence), status: 'acknowledged' };
  }

  public async finish(context: TeamToolContext) {
    this.policy.require(context, 'run.finalize');
    await this.executions.requestCompletion({
      teamRunId: context.teamRun.id,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      commandHash: commandHash('collaboration_finish', {}),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return { requested: true };
  }

  private async currentAttempt(context: TeamToolContext) {
    if (!context.attempt || context.task.teamTaskKind !== 'work_attempt')
      throw new TeamContextError('invalid_transition');
    const items = await this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner);
    const ordered = orderedWorkItems(items);
    const index = ordered.findIndex((item) => item.id === context.attempt!.workItemId);
    if (index < 0) throw new TeamContextError('not_found');
    return { attempt: context.attempt, ref: workRef(index) };
  }

  private async workByRef(context: TeamToolContext, ref: string) {
    const item = resolveWorkRef(
      ref,
      await this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner),
    );
    if (!item) throw new TeamContextError('not_found');
    return item;
  }

  private async refForWork(context: TeamToolContext, id: string) {
    const items = orderedWorkItems(
      await this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner),
    );
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new TeamContextError('not_found');
    return workRef(index);
  }

  private refForExistingWork(id: string, items: readonly { id: string; createdAt: string }[]) {
    const ordered = [...items].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const index = ordered.findIndex((item) => item.id === id);
    return index < 0 ? null : workRef(index);
  }

  private async memberByName(context: TeamToolContext, name: string, memberOnly: boolean) {
    const matches = (
      await this.executions.findMembersByTeamRunId(context.teamRun.id, context.owner)
    ).filter(
      (member) => member.name === name && (!memberOnly || member.role === 'member'),
    );
    if (matches.length !== 1) throw new TeamContextError('not_found');
    return matches[0]!;
  }

  private async allMessages(context: TeamToolContext) {
    if (this.messages.listForTeamRun)
      return this.messages.listForTeamRun(context.teamRun.id, context.owner);
    return this.messages.listDirectForTeamRun(context.teamRun.id, context.owner);
  }
}

function requireSafeText(value: string): string {
  const text = safeText(value);
  if (!text) throw new TeamContextError('invalid_request');
  return text;
}

function normalizeRefs(values: readonly string[] | undefined): readonly string[] {
  const refs = (values ?? [])
    .map((value) => safeText(value, 512))
    .filter((value): value is string => Boolean(value));
  if (refs.length !== (values ?? []).length || new Set(refs).size !== refs.length || refs.length > 16)
    throw new TeamContextError('invalid_request');
  return Object.freeze(refs);
}

function commandHash(name: string, input: unknown): string {
  return createHash('sha256').update(JSON.stringify([name, input])).digest('hex');
}

export function collaborationErrorCode(error: unknown): string {
  if (error instanceof CollaborationPolicyError) return error.code;
  if (error instanceof TeamContextError) return error.code;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  )
    return (error as { code: string }).code;
  return 'internal_error';
}
