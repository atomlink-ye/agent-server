import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import type { TeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
import { isTeamCompletionApprovalPending } from './team-policy-evaluator.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import type { TaskRecord, TaskRepository } from '../ports/task-repository.js';
import { safeText } from './safe-team-text.js';

export interface AgenticTeamProject {
  readonly stuck: boolean;
  readonly decisionCapture:
    | { readonly status: 'not_captured' }
    | { readonly status: 'reported'; readonly decisions: readonly never[] };
  readonly project: {
    readonly rootTaskId: string;
    readonly teamRunId: string;
    readonly teamVersionId: string;
    readonly status: 'active' | 'waiting' | 'succeeded' | 'failed';
    readonly phase: 'lead_kickoff' | 'member_work' | 'lead_finalize' | 'done';
    readonly finalText: string | null;
    readonly revision: number;
    readonly stopReason: string | null;
    readonly completionApprovalRequired: boolean;
    readonly completionDecisions: readonly TeamCompletionDecision[];
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly workItems: readonly {
    readonly workRef: string;
    readonly subject: string;
    readonly description: string | null;
    readonly status: string;
    readonly assigneeName: string | null;
    readonly dependencyRefs: readonly string[];
    readonly attempts: readonly {
      readonly attemptNo: number;
      readonly status: 'queued' | 'running' | 'completed' | 'failed';
      readonly feedbackSummary: string | null;
      readonly resultSummary: string | null;
    }[];
    readonly latestAttempt: {
      readonly attemptNo: number;
      readonly status: 'queued' | 'running' | 'completed' | 'failed';
      readonly feedbackSummary: string | null;
      readonly resultSummary: string | null;
    } | null;
  }[];
  readonly gates: {
    readonly finishReady: boolean;
    readonly allWorkAccepted: boolean;
    readonly noActiveAttempts: boolean;
    readonly allMembersIdle: boolean;
  };
  readonly directMessages: readonly {
    readonly sequence: number;
    readonly senderName: string;
    readonly recipientName: string;
    readonly summary: string;
    readonly status: 'delivered' | 'read';
    readonly createdAt: string;
  }[];
  readonly sessions: readonly {
    readonly teamMemberRunId: string;
    readonly name: string;
    readonly role: 'lead' | 'member';
    readonly status: 'starting' | 'active' | 'idle' | 'stopped' | 'failed';
    readonly turns: readonly {
      readonly taskId: string;
      readonly runId: string;
      readonly sequence: number;
      readonly kind: 'lead_turn' | 'work_attempt' | 'direct_message';
      readonly status: 'queued' | 'running' | 'completed' | 'failed';
      readonly context: string;
      readonly resultText: string | null;
      readonly workItemId: string | null;
      readonly attemptId: string | null;
      readonly attemptNo: number | null;
      readonly provider: string | null;
      readonly model: string | null;
      readonly createdAt: string;
      readonly updatedAt: string;
    }[];
  }[];
}

export class ProjectAgenticTeam {
  public constructor(
    private readonly teams: TeamExecutionRepository,
    private readonly messages: TeamMessageRepository,
    private readonly tasks: TaskRepository,
  ) {}

  public async execute(
    owner: OwnerScope,
    rootTaskId?: string,
  ): Promise<AgenticTeamProject | null> {
    const team = await this.teams.findLatestAgenticTeamRun(owner, rootTaskId);
    if (!team) return null;
    return this.project(team.id, owner);
  }

  public async project(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<AgenticTeamProject | null> {
    const team = await this.teams.findTeamRunById(teamRunId, owner);
    if (!team) return null;
    const [members, workItems, attempts, dependencies, messages, decisions] =
      await Promise.all([
        this.teams.findMembersByTeamRunId(team.id, owner),
        this.teams.findWorkItemsByTeamRunId(team.id, owner),
        this.teams.findAttemptsByTeamRunId(team.id, owner),
        this.teams.findWorkDependenciesByTeamRunId(team.id, owner),
        this.messages.listDirectForTeamRun(team.id, owner),
        this.teams.findCompletionDecisionsByTeamRunId(team.id, owner),
      ]);
    const completionDecisions = [...decisions].sort(
      (a, b) =>
        a.teamRevisionAtDecision - b.teamRevisionAtDecision ||
        a.decidedAt.localeCompare(b.decidedAt) ||
        a.id.localeCompare(b.id),
    );
    const currentDecision = completionDecisions.find(
      (decision) =>
        decision.completionRequestedByRunId === team.completionRequestedByRunId,
    );
    const approvalPending = isTeamCompletionApprovalPending(
      team,
      currentDecision,
    );
    const orderedWork = [...workItems].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const workRefById = new Map(
      orderedWork.map((work, index) => [work.id, `work-${index + 1}`]),
    );
    const nameByMemberId = new Map(
      members.map((member) => [member.id, member.name]),
    );
    const memberIds = new Set(members.map((member) => member.id));
    const records = (
      await this.tasks.findByRootTaskIdForOwner(team.rootTaskId, owner)
    ).filter(
      (record) =>
        record.task.teamMemberRunId !== null &&
        record.task.teamMemberRunId !== undefined &&
        memberIds.has(record.task.teamMemberRunId) &&
        (record.task.teamTaskKind === 'lead_turn' ||
          record.task.teamTaskKind === 'work_attempt' ||
          record.task.teamTaskKind === 'direct_message'),
    );
    const recordsByMember = new Map<string, TaskRecord[]>();
    for (const record of records) {
      const memberId = record.task.teamMemberRunId!;
      const bucket = recordsByMember.get(memberId) ?? [];
      bucket.push(record);
      recordsByMember.set(memberId, bucket);
    }
    const workById = new Map(workItems.map((work) => [work.id, work]));
    const messageById = new Map(
      messages.map((message) => [message.id, message]),
    );
    const attemptByTaskId = new Map(
      attempts
        .filter((attempt) => attempt.executionTaskId !== null)
        .map((attempt) => [attempt.executionTaskId!, attempt]),
    );
    const workProjection = orderedWork.map((work) => {
      const workAttempts = attempts
        .filter((attempt) => attempt.workItemId === work.id)
        .sort(compareAttempts);
      const latestAttempt = workAttempts.at(-1);
      return {
        workRef: workRefById.get(work.id)!,
        subject: safeText(work.subject) ?? '',
        description: safeText(work.description),
        status: work.status,
        assigneeName: work.ownerMemberId
          ? safeText(nameByMemberId.get(work.ownerMemberId) ?? null)
          : null,
        dependencyRefs: dependencies
          .filter((dependency) => dependency.workItemId === work.id)
          .map((dependency) => workRefById.get(dependency.dependsOnWorkItemId))
          .filter((ref): ref is string => Boolean(ref)),
        attempts: workAttempts.map((attempt) => ({
          attemptNo: attempt.attemptNo,
          status: attempt.status,
          feedbackSummary: safeText(attempt.feedback),
          resultSummary: safeText(attempt.resultSummary),
        })),
        latestAttempt: latestAttempt
          ? {
              attemptNo: latestAttempt.attemptNo,
              status: latestAttempt.status,
              feedbackSummary: safeText(latestAttempt.feedback),
              resultSummary: safeText(latestAttempt.resultSummary),
            }
          : null,
      };
    });
    const allWorkAccepted =
      orderedWork.length > 0 &&
      orderedWork.every((work) => work.status === 'accepted');
    const noActiveAttempts = attempts.every(
      (attempt) => attempt.status !== 'queued' && attempt.status !== 'running',
    );
    const allMembersIdle = members
      .filter((member) => member.role === 'member')
      .every(
        (member) => member.status === 'idle' || member.status === 'stopped',
      );
    const stuck =
      team.status === 'active' &&
      noActiveAttempts &&
      allMembersIdle &&
      !allWorkAccepted;
    const finalText =
      typeof team.finalText === 'string' ? safeText(team.finalText) : null;
    const hasCompletedFinalText =
      team.status === 'succeeded' && finalText !== null && finalText.length > 0;
    return {
      stuck,
      decisionCapture: hasCompletedFinalText
        ? { status: 'reported', decisions: [] }
        : { status: 'not_captured' },
      project: {
        rootTaskId: team.rootTaskId,
        teamRunId: team.id,
        teamVersionId: team.teamVersionId,
        status: approvalPending ? 'waiting' : team.status,
        phase: team.phase,
        finalText,
        revision: team.revision,
        stopReason: approvalPending
          ? 'approval_required'
          : safeText(team.stopReason),
        completionApprovalRequired: team.completionApprovalRequired,
        completionDecisions,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      },
      workItems: workProjection,
      gates: {
        finishReady: allWorkAccepted && noActiveAttempts && allMembersIdle,
        allWorkAccepted,
        noActiveAttempts,
        allMembersIdle,
      },
      directMessages: messages.flatMap((message) => {
        const senderName = message.senderMemberRunId
          ? safeText(nameByMemberId.get(message.senderMemberRunId) ?? null)
          : null;
        const recipientName = safeText(
          nameByMemberId.get(message.recipientMemberRunId) ?? null,
        );
        const summary = safeText(message.body);
        if (!senderName || !recipientName || !summary) return [];
        if (message.status !== 'delivered' && message.status !== 'read')
          return [];
        return [
          {
            sequence: message.sequence,
            senderName,
            recipientName,
            summary,
            status: message.status,
            createdAt: message.createdAt,
          },
        ];
      }),
      sessions: members.map((member) => {
        const memberRecords = recordsByMember.get(member.id) ?? [];
        return {
          teamMemberRunId: member.id,
          name: safeText(member.name, 512) ?? '',
          role: member.role,
          status: member.status,
          turns: memberRecords.sort(compareTasks).flatMap((record, index) => {
            const run = record.latestRun;
            if (!run) return [];
            const attempt = attemptByTaskId.get(record.task.id);
            const work = attempt ? workById.get(attempt.workItemId) : undefined;
            return [
              {
                taskId: record.task.id,
                runId: run.runId,
                sequence: record.task.teamSequence ?? index + 1,
                kind: record.task.teamTaskKind!,
                status: mapTurnStatus(run.status),
                context: contextFor(
                  record,
                  work,
                  attempt,
                  messageById.get(record.task.sourceTeamMessageId ?? ''),
                  nameByMemberId,
                  record.task.teamSequence ?? index + 1,
                ),
                resultText: safeText(run.result?.text ?? null),
                workItemId: work?.id ?? null,
                attemptId: attempt?.id ?? null,
                attemptNo: attempt?.attemptNo ?? null,
                provider: run.runtime?.provider ?? null,
                model: run.runtime?.model ?? null,
                createdAt: run.createdAt,
                updatedAt: run.updatedAt,
              },
            ];
          }),
        };
      }),
    };
  }
}

function compareAttempts(
  a: {
    readonly attemptNo: number;
    readonly createdAt: string;
    readonly id: string;
  },
  b: {
    readonly attemptNo: number;
    readonly createdAt: string;
    readonly id: string;
  },
): number {
  return (
    a.attemptNo - b.attemptNo ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function compareTasks(a: TaskRecord, b: TaskRecord): number {
  if (a.task.teamSequence != null && b.task.teamSequence != null)
    return (
      a.task.teamSequence - b.task.teamSequence ||
      a.task.createdAt.localeCompare(b.task.createdAt) ||
      a.task.id.localeCompare(b.task.id)
    );
  if (a.task.teamSequence != null) return -1;
  if (b.task.teamSequence != null) return 1;
  return (
    a.task.createdAt.localeCompare(b.task.createdAt) ||
    a.task.id.localeCompare(b.task.id)
  );
}

function contextFor(
  record: TaskRecord,
  work:
    | { readonly subject: string; readonly description: string | null }
    | undefined,
  attempt: { readonly feedback: string | null } | undefined,
  message:
    | {
        readonly body: string;
        readonly senderMemberRunId: string | null;
      }
    | undefined,
  names: ReadonlyMap<string, string>,
  sequence: number,
): string {
  if (record.task.teamTaskKind === 'lead_turn')
    return `Lead coordination turn ${sequence}`;
  if (record.task.teamTaskKind === 'direct_message') {
    const sender = message?.senderMemberRunId
      ? safeText(names.get(message.senderMemberRunId) ?? null, 256)
      : null;
    const body = safeText(message?.body ?? null, 512);
    return sender && body
      ? `Direct message from ${sender}: ${body}`
      : 'Direct message';
  }
  return (
    safeText(
      [
        attempt?.feedback ? `Lead feedback: ${attempt.feedback}` : '',
        work?.subject ?? 'Assigned work',
        work?.description ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
      512,
    ) ?? 'Assigned work'
  );
}

function mapTurnStatus(
  status: TaskRecord['latestRun'] extends infer R
    ? R extends { status: infer S }
      ? S
      : never
    : never,
): 'queued' | 'running' | 'completed' | 'failed' {
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'succeeded') return 'completed';
  return 'failed';
}
