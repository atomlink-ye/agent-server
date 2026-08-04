import type { TeamMessageRepository } from '../../application/ports/team-message-repository.js';
import type { OwnerScope } from '../../application/ports/team-execution-repository.js';
import type { TeamMessage } from '../../domain/teams/team-message.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}
interface MessageRow {
  id: string;
  team_run_id: string;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  sequence: number;
  sender_member_run_id: string | null;
  recipient_member_run_id: string;
  work_item_id: string | null;
  attempt_id: string | null;
  kind: TeamMessage['kind'];
  dedup_key: string;
  body: string;
  status: TeamMessage['status'];
  consumed_by_task_id: string | null;
  created_at: string | Date;
  consumed_at: string | Date | null;
}

export class PostgresTeamMessageRepository implements TeamMessageRepository {
  public constructor(private readonly database: Queryable) {}

  public async create(message: TeamMessage): Promise<TeamMessage> {
    const result = await this.database.query<MessageRow>(
      `INSERT INTO team_messages
        (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
         sender_member_run_id,recipient_member_run_id,work_item_id,attempt_id,kind,
         dedup_key,body,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,
         (SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
         $7,$8,$9,$10,$11,$12,$13,'queued',$14)
       ON CONFLICT (team_run_id,dedup_key) DO UPDATE SET dedup_key=EXCLUDED.dedup_key
       RETURNING *`,
      [
        message.id,
        message.teamRunId,
        message.tenantId,
        message.workspaceId,
        message.principalType,
        message.principalId,
        message.senderMemberRunId,
        message.recipientMemberRunId,
        message.workItemId,
        message.attemptId,
        message.kind,
        message.dedupKey,
        message.body,
        message.createdAt,
      ],
    );
    if (!result.rows?.[0]) {
      const existing = await this.database.query<MessageRow>(
        'SELECT * FROM team_messages WHERE team_run_id=$1 AND dedup_key=$2',
        [message.teamRunId, message.dedupKey],
      );
      if (!existing.rows?.[0])
        throw new Error('Team message could not be persisted.');
      return mapMessage(existing.rows[0]);
    }
    return mapMessage(result.rows[0]);
  }

  public async listQueuedWakeRoots() {
    const result = await this.database.query<{
      root_task_id: string;
      tenant_id: string;
      workspace_id: string;
      principal_type: string;
      principal_id: string;
    }>(
      `SELECT DISTINCT tr.root_task_id,tr.tenant_id,tr.workspace_id,tr.principal_type,tr.principal_id
         FROM team_messages m
         JOIN team_runs tr ON tr.id=m.team_run_id
        WHERE m.status='queued'
        ORDER BY tr.root_task_id`,
    );
    return (result.rows ?? []).map((row) => ({
      rootTaskId: row.root_task_id,
      owner: {
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        principalType: row.principal_type,
        principalId: row.principal_id,
      },
    }));
  }
  public async listQueuedForMember(
    teamRunId: string,
    memberId: string,
    owner: OwnerScope,
  ) {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM team_messages
       WHERE team_run_id=$1 AND recipient_member_run_id=$2 AND status='queued'
         AND tenant_id=$3 AND workspace_id=$4 AND principal_type=$5 AND principal_id=$6
       ORDER BY sequence,id`,
      [teamRunId, memberId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }

  public async bindToTask(input: {
    messageIds: readonly string[];
    taskId: string;
    owner: OwnerScope;
  }) {
    if (input.messageIds.length === 0) return [];
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages SET status='consumed', consumed_by_task_id=$2, consumed_at=now()
       WHERE id = ANY($1::uuid[]) AND status='queued'
         AND tenant_id=$3 AND workspace_id=$4 AND principal_type=$5 AND principal_id=$6
       RETURNING *`,
      [input.messageIds, input.taskId, ...ownerValues(input.owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }
}

function ownerValues(owner: OwnerScope): readonly string[] {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
  ];
}
function mapMessage(row: MessageRow): TeamMessage {
  return Object.freeze({
    id: row.id,
    teamRunId: row.team_run_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    sequence: Number(row.sequence),
    senderMemberRunId: row.sender_member_run_id,
    recipientMemberRunId: row.recipient_member_run_id,
    workItemId: row.work_item_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    dedupKey: row.dedup_key,
    body: row.body,
    status: row.status,
    consumedByTaskId: row.consumed_by_task_id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    consumedAt:
      row.consumed_at instanceof Date
        ? row.consumed_at.toISOString()
        : row.consumed_at,
  });
}
