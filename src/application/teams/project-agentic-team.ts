import type { TaskRecord, TaskRepository } from '../ports/task-repository.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';

const MAX_CONTEXT_LENGTH = 512;
const MAX_RESULT_LENGTH = 4096;

export interface AgenticTeamProject {
  readonly project: {
    readonly rootTaskId: string;
    readonly teamRunId: string;
    readonly teamVersionId: string;
    readonly status: 'active' | 'waiting' | 'succeeded' | 'failed';
    readonly finalText: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly sessions: readonly {
    readonly teamMemberRunId: string;
    readonly name: string;
    readonly role: 'lead' | 'member';
    readonly status: 'starting' | 'active' | 'idle' | 'stopped' | 'failed';
    readonly turns: readonly {
      readonly taskId: string;
      readonly runId: string;
      readonly sequence: number;
      readonly kind: 'lead_turn' | 'work_attempt';
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
    private readonly tasks: TaskRepository,
  ) {}

  public async execute(
    owner: OwnerScope,
    rootTaskId?: string,
  ): Promise<AgenticTeamProject | null> {
    const team = await this.teams.findLatestAgenticTeamRun(owner, rootTaskId);
    if (!team) return null;
    const members = await this.teams.findMembersByTeamRunId(team.id, owner);
    const memberIds = new Set(members.map((member) => member.id));
    const records = (
      await this.tasks.findByRootTaskIdForOwner(team.rootTaskId, owner)
    ).filter(
      (record) =>
        record.task.teamMemberRunId !== null &&
        record.task.teamMemberRunId !== undefined &&
        memberIds.has(record.task.teamMemberRunId) &&
        (record.task.teamTaskKind === 'lead_turn' ||
          record.task.teamTaskKind === 'work_attempt'),
    );
    const attempts = await this.teams.findAttemptsByTeamRunId(team.id, owner);
    const workItems = await this.teams.findWorkItemsByTeamRunId(team.id, owner);
    const workById = new Map(workItems.map((item) => [item.id, item]));
    const attemptByTaskId = new Map(
      attempts
        .filter((attempt) => attempt.executionTaskId !== null)
        .map((attempt) => [attempt.executionTaskId!, attempt]),
    );
    const recordsByMember = new Map<string, TaskRecord[]>();
    for (const record of records) {
      const memberId = record.task.teamMemberRunId!;
      const bucket = recordsByMember.get(memberId) ?? [];
      bucket.push(record);
      recordsByMember.set(memberId, bucket);
    }
    return {
      project: {
        rootTaskId: team.rootTaskId,
        teamRunId: team.id,
        teamVersionId: team.teamVersionId,
        status: team.status,
        finalText: safeText(team.finalText, MAX_RESULT_LENGTH),
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      },
      sessions: members.map((member) => {
        const memberRecords = recordsByMember.get(member.id) ?? [];
        const ordered = memberRecords.sort(compareTasks);
        return {
          teamMemberRunId: member.id,
          name: safeText(member.name, MAX_CONTEXT_LENGTH) ?? '',
          role: member.role,
          status: member.status,
          turns: ordered.flatMap((record, index) => {
            const run = record.latestRun;
            if (!run) return [];
            const attempt = attemptByTaskId.get(record.task.id);
            const workItem = attempt
              ? workById.get(attempt.workItemId)
              : undefined;
            return [
              {
                taskId: record.task.id,
                runId: run.runId,
                sequence: record.task.teamSequence ?? index + 1,
                kind: record.task.teamTaskKind!,
                status: mapTurnStatus(run.status),
                context: contextFor(
                  record,
                  workItem,
                  attempt,
                  record.task.teamSequence ?? index + 1,
                ),
                resultText: safeText(
                  run.result?.text ?? null,
                  MAX_RESULT_LENGTH,
                ),
                workItemId: workItem?.id ?? null,
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
  workItem:
    | {
        readonly subject: string;
        readonly description: string | null;
      }
    | undefined,
  attempt:
    | {
        readonly feedback: string | null;
      }
    | undefined,
  sequence: number,
): string {
  if (record.task.teamTaskKind === 'lead_turn')
    return `Lead coordination turn ${sequence}`;
  const assignment = workItem?.subject ?? 'Assigned work';
  const description = workItem?.description ?? '';
  const feedback = attempt?.feedback ?? '';
  return (
    safeText(
      [feedback ? `Lead feedback: ${feedback}` : '', assignment, description]
        .filter(Boolean)
        .join('\n'),
      MAX_CONTEXT_LENGTH,
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

function safeText(value: string | null, limit: number): string | null {
  if (value === null) return null;
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit);
}
