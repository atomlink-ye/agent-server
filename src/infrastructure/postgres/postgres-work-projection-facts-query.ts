import type {
  WorkProjectionActorFact,
  WorkProjectionAttemptFact,
  WorkProjectionDependencyFact,
  WorkProjectionFacts,
  WorkProjectionFactsReader,
  WorkProjectionMessageFact,
  WorkProjectionSourceRefs,
  WorkProjectionWorkItemFact,
  WorkProjectionWorkspaceScope,
} from '../../application/work/work-projection-facts.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface TeamRunRow {
  id: string;
  root_task_id: string;
  status: WorkProjectionFacts['teamRunStatus'];
  phase: string | null;
  revision: number | string | null;
  completion_approval_required: boolean | null;
  completion_requested_by_run_id: string | null;
  final_text: string | null;
  approval_accepted: boolean | null;
}

interface MemberRow {
  id: string;
  team_run_id: string;
  name: string | null;
}

interface WorkItemRow {
  id: string;
  team_run_id: string;
  subject: string | null;
  description: string | null;
  status: string;
  owner_member_id: string | null;
}

interface AttemptRow {
  id: string;
  work_item_id: string;
  team_run_id: string;
  attempt_no: number;
  status: WorkProjectionAttemptFact['status'];
  assignee_member_id: string;
  requested_by_lead_task_id: string;
  reviewer_member_id: string | null;
  created_at: string | Date;
  feedback_present: boolean;
  result_present: boolean;
  execution_task_id: string | null;
}

interface DependencyRow {
  team_run_id: string;
  work_item_id: string;
  depends_on_work_item_id: string;
  created_at: string | Date;
}

interface MessageRow {
  id: string;
  team_run_id: string;
  sequence: number;
  sender_member_run_id: string | null;
  recipient_member_run_id: string;
  work_item_id: string | null;
  attempt_id: string | null;
  kind: string;
  status: string;
  consumed_task_id: string | null;
  scoped_task_id: string | null;
  body_present: boolean;
  created_at: string | Date;
}

export class PostgresWorkProjectionFactsQuery implements WorkProjectionFactsReader {
  public constructor(private readonly database: Queryable) {}

  public async getByRootTask(
    owner: WorkProjectionWorkspaceScope,
    rootTaskId: string,
  ): Promise<WorkProjectionFacts | null> {
    const scope = [owner.tenantId, owner.workspaceId] as const;
    const teamResult = await this.database.query<TeamRunRow>(
      `SELECT tr.id,tr.root_task_id,tr.status,tr.phase,tr.revision,
              tr.completion_approval_required,
              tr.completion_requested_by_run_id,tr.final_text,
              (NOT tr.completion_approval_required OR EXISTS (
                SELECT 1
                  FROM team_completion_decisions d
                 WHERE d.team_run_id=tr.id
                   AND d.completion_requested_by_run_id=tr.completion_requested_by_run_id
                   AND d.decision='approve'
                   AND d.tenant_id=$2 AND d.workspace_id=$3
              )) AS approval_accepted
         FROM team_runs tr
        WHERE tr.root_task_id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3
        LIMIT 1`,
      [rootTaskId, ...scope],
    );
    const team = teamResult.rows?.[0];
    if (!team) return null;

    const [
      membersResult,
      itemsResult,
      attemptsResult,
      dependenciesResult,
      messagesResult,
    ] = await Promise.all([
      this.database.query<MemberRow>(
        `SELECT id,team_run_id,name FROM team_member_runs
            WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3
            ORDER BY created_at,id`,
        [team.id, ...scope],
      ),
      this.database.query<WorkItemRow>(
        `SELECT id,team_run_id,subject,description,status,owner_member_id
             FROM team_work_items
            WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3
            ORDER BY created_at,id`,
        [team.id, ...scope],
      ),
      this.database.query<AttemptRow>(
        `SELECT a.id,a.work_item_id,a.team_run_id,a.attempt_no,a.status,
                  a.assignee_member_id,a.requested_by_lead_task_id,
                  reviewer.team_member_run_id AS reviewer_member_id,
                  a.created_at,
                  (a.feedback IS NOT NULL) AS feedback_present,
                  (a.result_summary IS NOT NULL) AS result_present,
                  a.execution_task_id
             FROM team_work_item_attempts a
             LEFT JOIN tasks reviewer
               ON reviewer.id=a.requested_by_lead_task_id
              AND reviewer.root_task_id=$4
              AND reviewer.tenant_id=$2 AND reviewer.workspace_id=$3
            WHERE a.team_run_id=$1 AND a.tenant_id=$2 AND a.workspace_id=$3
            ORDER BY a.created_at,a.attempt_no,a.id`,
        [team.id, ...scope, rootTaskId],
      ),
      this.database.query<DependencyRow>(
        `SELECT team_run_id,work_item_id,depends_on_work_item_id,created_at
             FROM team_work_item_dependencies
            WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3
            ORDER BY work_item_id,depends_on_work_item_id`,
        [team.id, ...scope],
      ),
      this.database.query<MessageRow>(
        `SELECT m.id,m.team_run_id,m.sequence,m.sender_member_run_id,
                  m.recipient_member_run_id,m.work_item_id,m.attempt_id,
                  m.kind,m.status,m.created_at,
                  m.consumed_by_task_id AS consumed_task_id,
                  t.id AS scoped_task_id,
                  (m.body IS NOT NULL) AS body_present
             FROM team_messages m
             LEFT JOIN tasks t
               ON t.id=m.consumed_by_task_id
              AND t.root_task_id=$4
              AND t.tenant_id=$2 AND t.workspace_id=$3
            WHERE m.team_run_id=$1 AND m.tenant_id=$2 AND m.workspace_id=$3
            ORDER BY m.sequence,m.id`,
        [team.id, ...scope, rootTaskId],
      ),
    ]);

    const members = membersResult.rows ?? [];
    const items = itemsResult.rows ?? [];
    const attempts = attemptsResult.rows ?? [];
    const dependencies = dependenciesResult.rows ?? [];
    const messages = messagesResult.rows ?? [];
    const memberById = new Map(members.map((member) => [member.id, member]));

    const actors: WorkProjectionActorFact[] = members.map((member) => ({
      id: member.id,
      name: member.name ?? null,
      sourceRefs: {
        rootTaskId: team.root_task_id,
        teamRunId: team.id,
        teamMemberRunId: member.id,
      },
    }));
    const attemptsByWork = new Map<string, WorkProjectionAttemptFact[]>();
    for (const attempt of attempts) {
      const bucket = attemptsByWork.get(attempt.work_item_id) ?? [];
      bucket.push({
        id: attempt.id,
        workItemId: attempt.work_item_id,
        attemptNo: attempt.attempt_no,
        status: attempt.status,
        assigneeActorId: attempt.assignee_member_id,
        requestedByLeadTaskId: attempt.requested_by_lead_task_id,
        reviewerActorId: attempt.reviewer_member_id ?? null,
        createdAt: toIso(attempt.created_at),
        feedbackCapture: attempt.feedback_present ? 'present' : 'absent',
        resultCapture: attempt.result_present ? 'present' : 'absent',
        executionRunCount: 0,
        startedAt: null,
        endedAt: null,
        sourceRefs: {
          rootTaskId: team.root_task_id,
          teamRunId: team.id,
          ...(attempt.execution_task_id
            ? { taskId: attempt.execution_task_id }
            : {}),
        },
      });
      attemptsByWork.set(attempt.work_item_id, bucket);
    }
    const workItems: WorkProjectionWorkItemFact[] = items.map((item) => ({
      id: item.id,
      subject: item.subject ?? '',
      description: item.description ?? null,
      status: item.status,
      actorId: item.owner_member_id ?? null,
      attempts: attemptsByWork.get(item.id) ?? [],
      sourceRefs: { rootTaskId: team.root_task_id, teamRunId: team.id },
    }));
    const dependencyFacts: WorkProjectionDependencyFact[] = dependencies.map(
      (dependency) => ({
        teamRunId: dependency.team_run_id,
        sourceWorkItemId: dependency.work_item_id,
        dependencyWorkItemId: dependency.depends_on_work_item_id,
        createdAt: toIso(dependency.created_at),
      }),
    );
    const messageFacts: WorkProjectionMessageFact[] = messages.map(
      (message) => {
        const sender = message.sender_member_run_id
          ? memberById.get(message.sender_member_run_id)
          : undefined;
        const recipient = memberById.get(message.recipient_member_run_id);
        const sourceRefs: WorkProjectionSourceRefs = {
          rootTaskId: team.root_task_id,
          teamRunId: team.id,
          teamMessageId: message.id,
          ...(message.scoped_task_id ? { taskId: message.scoped_task_id } : {}),
        };
        return {
          id: message.id,
          senderId: message.sender_member_run_id ?? null,
          recipientId: message.recipient_member_run_id,
          workItemId: message.work_item_id ?? null,
          attemptId: message.attempt_id ?? null,
          sequence: message.sequence,
          createdAt: toIso(message.created_at),
          senderName: sender?.name ?? null,
          recipientName: recipient?.name ?? null,
          bodyCapture: message.body_present ? 'present' : 'absent',
          sourceRefs,
        };
      },
    );
    return {
      rootTaskId: team.root_task_id,
      teamRunId: team.id,
      teamRunStatus: team.status ?? null,
      teamRunPhase: team.phase ?? null,
      teamRunRevision:
        team.revision === null || team.revision === undefined
          ? null
          : Number(team.revision),
      completionApprovalRequired: team.completion_approval_required ?? null,
      completionRequestedByRunId: team.completion_requested_by_run_id ?? null,
      approvalAccepted: team.approval_accepted ?? false,
      finalText: team.final_text ?? null,
      finalTextPresent:
        team.final_text !== null && team.final_text !== undefined,
      workItems,
      actors,
      dependencies: dependencyFacts,
      messages: messageFacts,
    };
  }
}

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
