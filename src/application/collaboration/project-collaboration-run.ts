import {
  messageRef,
  orderedWorkItems,
  projectBoardStatus,
  projectMessageStatus,
  workRef,
} from '../../domain/collaboration/collaboration.js';
import type { CollaborationRepository } from '../ports/collaboration-repository.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import { safeText } from '../teams/safe-team-text.js';

/** Safe, provider-neutral replay projection for the Collaboration Lens. */
export class ProjectCollaborationRun {
  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly messages: TeamMessageRepository,
    private readonly journal: CollaborationRepository,
  ) {}

  public async project(teamRunId: string, owner: OwnerScope) {
    const team = await this.executions.findTeamRunById(teamRunId, owner);
    if (!team) return null;
    const [members, items, attempts, dependencies, messages, checkpoints, submissions] =
      await Promise.all([
        this.executions.findMembersByTeamRunId(teamRunId, owner),
        this.executions.findWorkItemsByTeamRunId(teamRunId, owner),
        this.executions.findAttemptsByTeamRunId(teamRunId, owner),
        this.executions.findWorkDependenciesByTeamRunId(teamRunId, owner),
        this.messages.listForTeamRun?.(teamRunId, owner) ??
          this.messages.listDirectForTeamRun(teamRunId, owner),
        this.journal.listCheckpoints(teamRunId, owner),
        this.journal.listSubmissions(teamRunId, owner),
      ]);
    const ordered = orderedWorkItems(items);
    const workRefById = new Map(
      ordered.map((item, index) => [item.id, workRef(index)]),
    );
    const participantNameById = new Map(
      members.map((member) => [member.id, safeText(member.name) ?? 'participant']),
    );
    const messageRefById = new Map(
      messages.map((message) => [message.id, messageRef(message.sequence)]),
    );
    const checkpointById = new Map(checkpoints.map((entry) => [entry.id, entry]));
    void checkpointById;

    return {
      collaboration_run_id: team.id,
      status: team.status,
      participants: members.map((member) => ({
        name: safeText(member.name) ?? '',
        role: member.role,
        status: member.status,
      })),
      board: ordered.map((item, index) => {
        const itemAttempts = attempts
          .filter((attempt) => attempt.workItemId === item.id)
          .sort((left, right) => left.attemptNo - right.attemptNo);
        const latestCheckpoint = checkpoints
          .filter((entry) => entry.workItemId === item.id)
          .at(-1);
        const latestSubmission = submissions
          .filter((entry) => entry.workItemId === item.id)
          .at(-1);
        return {
          work_ref: workRef(index),
          subject: safeText(item.subject) ?? '',
          description: safeText(item.description),
          status: projectBoardStatus(item, itemAttempts),
          owner: item.ownerMemberId
            ? participantNameById.get(item.ownerMemberId) ?? null
            : null,
          dependency_refs: dependencies
            .filter((edge) => edge.workItemId === item.id)
            .flatMap((edge) => {
              const ref = workRefById.get(edge.dependsOnWorkItemId);
              return ref ? [ref] : [];
            }),
          latest_attempt_no: itemAttempts.at(-1)?.attemptNo ?? null,
          latest_checkpoint: latestCheckpoint
            ? {
                summary: safeText(latestCheckpoint.summary) ?? '',
                next_step: safeText(latestCheckpoint.nextStep),
                blocker: safeText(latestCheckpoint.blocker),
                evidence_refs: [...latestCheckpoint.evidenceRefs],
                created_at: latestCheckpoint.createdAt,
              }
            : null,
          latest_submission: latestSubmission
            ? {
                attempt_no: latestSubmission.attemptNo,
                summary: safeText(latestSubmission.summary) ?? '',
                evidence_refs: [...latestSubmission.evidenceRefs],
                artifact_refs: [...latestSubmission.artifactRefs],
                created_at: latestSubmission.createdAt,
              }
            : null,
        };
      }),
      mailbox: messages
        .filter((message) => message.kind === 'direct')
        .map((message) => ({
          message_ref: messageRef(message.sequence),
          from: message.senderMemberRunId
            ? participantNameById.get(message.senderMemberRunId) ?? 'participant'
            : 'system',
          to:
            participantNameById.get(message.recipientMemberRunId) ?? 'participant',
          body: safeText(message.body) ?? '',
          about_work_ref: message.aboutWorkItemId
            ? workRefById.get(message.aboutWorkItemId) ?? null
            : null,
          reply_to_ref: message.replyToMessageId
            ? messageRefById.get(message.replyToMessageId) ?? null
            : null,
          priority: message.priority,
          requires_ack: message.requiresAck,
          status: projectMessageStatus(message),
          created_at: message.createdAt,
          acknowledged_at: message.acknowledgedAt,
        })),
      checkpoints: checkpoints.map((entry) => ({
        checkpoint_id: entry.id,
        work_ref: workRefById.get(entry.workItemId) ?? null,
        participant:
          participantNameById.get(entry.participantId) ?? 'participant',
        summary: safeText(entry.summary) ?? '',
        next_step: safeText(entry.nextStep),
        blocker: safeText(entry.blocker),
        evidence_refs: [...entry.evidenceRefs],
        created_at: entry.createdAt,
      })),
      submissions: submissions.map((entry) => ({
        submission_id: entry.id,
        work_ref: workRefById.get(entry.workItemId) ?? null,
        attempt_no: entry.attemptNo,
        participant:
          participantNameById.get(entry.submittedByParticipantId) ?? 'participant',
        summary: safeText(entry.summary) ?? '',
        evidence_refs: [...entry.evidenceRefs],
        artifact_refs: [...entry.artifactRefs],
        created_at: entry.createdAt,
      })),
    };
  }
}
