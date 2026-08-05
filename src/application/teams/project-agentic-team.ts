import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import type { TaskRecord, TaskRepository } from '../ports/task-repository.js';

const MAX_SAFE_TEXT_LENGTH = 4096;

export interface AgenticTeamProject {
  readonly project: {
    readonly rootTaskId: string;
    readonly teamRunId: string;
    readonly teamVersionId: string;
    readonly status: 'active' | 'waiting' | 'succeeded' | 'failed';
    readonly phase: 'lead_kickoff' | 'member_work' | 'lead_finalize' | 'done';
    readonly finalText: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly workItems: readonly {
    readonly workRef: string;
    readonly subject: string;
    readonly status: string;
    readonly assigneeName: string | null;
    readonly dependencyRefs: readonly string[];
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
    const [members, workItems, attempts, dependencies, messages] =
      await Promise.all([
        this.teams.findMembersByTeamRunId(team.id, owner),
        this.teams.findWorkItemsByTeamRunId(team.id, owner),
        this.teams.findAttemptsByTeamRunId(team.id, owner),
        this.teams.findWorkDependenciesByTeamRunId(team.id, owner),
        this.messages.listDirectForTeamRun(team.id, owner),
      ]);
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
      const latestAttempt = attempts
        .filter((attempt) => attempt.workItemId === work.id)
        .sort((a, b) => b.attemptNo - a.attemptNo)[0];
      return {
        workRef: workRefById.get(work.id)!,
        subject: safeText(work.subject) ?? '',
        status: work.status,
        assigneeName: work.ownerMemberId
          ? safeText(nameByMemberId.get(work.ownerMemberId) ?? null)
          : null,
        dependencyRefs: dependencies
          .filter((dependency) => dependency.workItemId === work.id)
          .map((dependency) => workRefById.get(dependency.dependsOnWorkItemId))
          .filter((ref): ref is string => Boolean(ref)),
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
    return {
      project: {
        rootTaskId: team.rootTaskId,
        teamRunId: team.id,
        teamVersionId: team.teamVersionId,
        status: team.status,
        phase: team.phase,
        finalText: safeText(team.finalText),
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

function safeText(
  value: string | null,
  limit = MAX_SAFE_TEXT_LENGTH,
): string | null {
  if (value === null) return null;
  return value
    .replace(/bearer\s+(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '[redacted]')
    .replace(
      /["']?\b(?:(?:access|refresh|id)[-_ ]?token|credential|token|password|secret|api[-_ ]?key)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      '[redacted]',
    )
    .replace(
      /(?:^|[\s"'=])(?:~\/|\/|[A-Za-z]:\\)[^\s"'`]+/g,
      '$1[redacted path]',
    )
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit);
}
